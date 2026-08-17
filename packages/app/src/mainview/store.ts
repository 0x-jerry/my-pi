import { inject, reactive, type InjectionKey } from "vue"
import {
  RpcEvent,
  RpcMethod,
  type CreateSessionInput,
  type ModelInfo,
  type PluginInfo,
  type ProviderInfo,
  type SessionInfo,
  type StoredMessage,
  type ThinkingLevel,
  type UsageSummary,
  type Workspace,
} from "@my-pi/shared"
import { RpcClient, type ConnectionState } from "./rpc/client"

export interface ActiveToolState {
  toolCallId: string
  toolName: string
  args: unknown
  partialResult?: unknown
  result?: unknown
  isError?: boolean
}

/**
 * A local-only placeholder session shown in the tree after clicking "+".
 * No server row exists until the first message is sent (see sendDraft).
 */
export interface DraftSession {
  localId: string
  workspaceId: string
}

/** A completed streamed segment (frozen at a tool boundary mid-run). */
export interface StreamedPart {
  text: string
  thinking: string
}

export interface StreamingState {
  status: "idle" | "running" | "stopped" | "error"
  error?: string
  textBuf: string
  thinkingBuf: string
  /** Completed assistant segments from earlier in the current run. */
  parts: StreamedPart[]
  activeTool: ActiveToolState | null
  /** The user prompt just sent; rendered optimistically until run_end. */
  pendingSend: string | null
}

function emptyStreaming(): StreamingState {
  return {
    status: "idle",
    textBuf: "",
    thinkingBuf: "",
    parts: [],
    activeTool: null,
    pendingSend: null,
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Reactive store + actions. Owns the RpcClient and translates every
 * notification into state transitions. Views stay dumb and read `state`.
 *
 * Sync rule: mutating calls that push no event (workspaces.create,
 * sessions.create/delete/fork, plugins.*, settings.*) refetch the affected
 * list; the server only pushes `workspace.updated` + per-session events.
 */
export class Store {
  readonly client: RpcClient

  readonly state = reactive({
    connectionState: "closed" as ConnectionState,
    workspaces: [] as Workspace[],
    activeWorkspaceId: null as string | null,
    sessions: [] as SessionInfo[],
    activeSessionId: null as string | null,
    drafts: [] as DraftSession[],
    messagesBySession: {} as Record<string, StoredMessage[]>,
    streaming: {} as Record<string, StreamingState>,
    lastUsage: {} as Record<string, UsageSummary | undefined>,
    providers: [] as ProviderInfo[],
    models: {} as Record<string, ModelInfo[]>,
    pluginsGlobal: [] as PluginInfo[],
    pluginsWorkspace: {} as Record<string, PluginInfo[]>,
    settings: {} as Record<string, unknown>,
    /** Global error banner (boot failures, send errors, etc.). */
    error: null as string | null,
  })

  constructor(client: RpcClient) {
    this.client = client
    client.onRefreshAll = () => void this.refreshAll()
    client.onConnectionStateChange = (s) => {
      this.state.connectionState = s
    }
    // Handlers are wrapped so refetch failures during a drop surface in the
    // error banner instead of becoming unhandled rejections.
    this.on(RpcEvent.sessionStatus, (p) => this.handleStatus(p))
    this.on(RpcEvent.sessionDelta, (p) => this.handleDelta(p))
    this.on(RpcEvent.sessionToolStart, (p) => this.handleToolStart(p))
    this.on(RpcEvent.sessionToolUpdate, (p) => this.handleToolUpdate(p))
    this.on(RpcEvent.sessionToolEnd, (p) => this.handleToolEnd(p))
    this.on(RpcEvent.sessionMessageEnd, (p) => this.handleMessageEnd(p))
    this.on(RpcEvent.sessionRunEnd, (p) => this.handleRunEnd(p))
    this.on(RpcEvent.sessionTitleUpdated, (p) => this.handleTitleUpdated(p))
    this.on(RpcEvent.workspaceUpdated, (p) => this.handleWorkspaceUpdated(p))
  }

  /** Register a notification handler with unhandled-rejection protection. */
  private on(method: string, handler: (p: unknown) => void | Promise<void>): void {
    this.client.on(method, (p) => {
      try {
        const result = handler(p)
        if (result instanceof Promise) {
          result.catch((err) => {
            this.state.error = errMessage(err)
          })
        }
      } catch (err) {
        this.state.error = errMessage(err)
      }
    })
  }

  /** Start the connection; `refreshAll()` runs on first connect. */
  init(): void {
    this.client.connect()
  }

  // ---- loading / refresh ----

  /**
   * Re-sync everything on (re)connect, including the active workspace's
   * sessions and the active session's transcript: runs that finished while
   * disconnected push no notifications to the new connection.
   */
  async refreshAll(): Promise<void> {
    await Promise.allSettled([
      this.loadWorkspaces(),
      this.loadProviders(),
      this.loadPluginsGlobal(),
      this.loadSettings(),
      this.state.activeWorkspaceId
        ? this.loadSessions(this.state.activeWorkspaceId)
        : Promise.resolve(),
      this.state.activeSessionId && !this.isDraft(this.state.activeSessionId)
        ? this.loadMessages(this.state.activeSessionId)
        : Promise.resolve(),
    ])
  }

  async loadWorkspaces(): Promise<void> {
    this.state.workspaces = await this.client.call<Workspace[]>(
      RpcMethod.workspacesList,
      {},
    )
  }

  async loadSessions(workspaceId: string): Promise<void> {
    this.state.sessions = await this.client.call<SessionInfo[]>(
      RpcMethod.sessionsList,
      { workspaceId },
    )
  }

  /** Fetch (or re-fetch) the transcript for one session into the store. */
  async loadMessages(sessionId: string): Promise<void> {
    this.state.messagesBySession[sessionId] =
      await this.client.call<StoredMessage[]>(RpcMethod.sessionsMessages, {
        id: sessionId,
      })
  }

  /** Debounced (per-microtask) refetch of a workspace's session list. */
  private sessionsRefreshQueued = false
  private scheduleSessionsRefresh(workspaceId: string): void {
    if (this.sessionsRefreshQueued) return
    this.sessionsRefreshQueued = true
    queueMicrotask(() => {
      this.sessionsRefreshQueued = false
      void this.loadSessions(workspaceId).catch((err) => {
        this.state.error = errMessage(err)
      })
    })
  }

  async loadProviders(): Promise<void> {
    this.state.providers = await this.client.call<ProviderInfo[]>(
      RpcMethod.modelsProviders,
      {},
    )
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    const models = await this.client.call<ModelInfo[]>(
      RpcMethod.modelsAvailable,
      { providerId },
    )
    this.state.models[providerId] = models
    return models
  }

  async loadPluginsGlobal(): Promise<void> {
    this.state.pluginsGlobal = await this.client.call<PluginInfo[]>(
      RpcMethod.pluginsList,
      {},
    )
  }

  async loadPluginsForWorkspace(workspaceId: string): Promise<void> {
    this.state.pluginsWorkspace[workspaceId] = await this.client.call<PluginInfo[]>(
      RpcMethod.pluginsList,
      { workspaceId },
    )
  }

  async loadSettings(): Promise<void> {
    const defaultModel = await this.client.call<
      { provider: string; id: string } | undefined
    >(RpcMethod.settingsGet, { key: "defaultModel" })
    if (defaultModel) this.state.settings.defaultModel = defaultModel
    const thinking = await this.client.call<ThinkingLevel | undefined>(
      RpcMethod.settingsGet,
      { key: "defaultThinkingLevel" },
    )
    if (thinking) this.state.settings.defaultThinkingLevel = thinking
  }

  // ---- workspaces ----

  /** Open the shell's native folder picker; resolves to a path or null. */
  async pickFolder(): Promise<string | null> {
    return this.client.call<string | null>(RpcMethod.dialogsPickFolder)
  }

  async createWorkspace(name: string, path: string): Promise<Workspace> {
    const ws = await this.client.call<Workspace>(RpcMethod.workspacesCreate, {
      name,
      path,
    })
    await this.loadWorkspaces()
    return ws
  }

  async removeWorkspace(id: string): Promise<void> {
    await this.client.call<void>(RpcMethod.workspacesRemove, { id })
    if (this.state.activeWorkspaceId === id) {
      this.state.activeWorkspaceId = null
      this.state.activeSessionId = null
      this.state.sessions = []
    }
    this.state.drafts = this.state.drafts.filter((d) => d.workspaceId !== id)
    await this.loadWorkspaces()
  }

  async openWorkspace(id: string): Promise<void> {
    this.state.activeWorkspaceId = id
    this.state.activeSessionId = null
    await this.loadSessions(id)
    void this.loadPluginsForWorkspace(id).catch((err) => {
      this.state.error = errMessage(err)
    })
  }

  // ---- drafts (placeholder sessions created via the tree "+") ----

  private draftSeq = 0

  /** Add a local placeholder node; the server session appears on first message. */
  startDraft(workspaceId: string): string {
    const localId = `draft:${++this.draftSeq}:${Date.now()}`
    this.state.drafts.push({ localId, workspaceId })
    return localId
  }

  /** Select a draft node without any server transcript load. */
  openDraft(localId: string): void {
    if (!this.isDraft(localId)) return
    this.state.activeSessionId = localId
  }

  /** Drop a local placeholder (no server call). */
  discardDraft(localId: string): void {
    this.state.drafts = this.state.drafts.filter((d) => d.localId !== localId)
    if (this.state.activeSessionId === localId) this.state.activeSessionId = null
  }

  isDraft(id: string): boolean {
    return this.state.drafts.some((d) => d.localId === id)
  }

  /**
   * First message of a draft: create the real session server-side (autoTitle
   * so the LLM names it after this run), then send the prompt. The draft is
   * replaced by the persisted session node (createSession refetches the list).
   */
  async sendDraft(localId: string, text: string): Promise<void> {
    const draft = this.state.drafts.find((d) => d.localId === localId)
    if (!draft) throw new Error("Draft session not found")
    // A draft's session is created with the default model. Bail before
    // converting the draft so the composer stays put (message intact) instead
    // of stranding the user on an empty real session with no model to run.
    if (!this.state.settings.defaultModel) {
      throw new Error(
        "No model configured. Choose a default model in Settings before starting a session.",
      )
    }
    const session = await this.createSession({
      workspaceId: draft.workspaceId,
      autoTitle: true,
      model: this.state.settings.defaultModel as { provider: string; id: string },
    })
    this.state.drafts = this.state.drafts.filter((d) => d.localId !== localId)
    await this.openSession(session.id)
    await this.sendMessage(session.id, text)
  }

  // ---- sessions ----

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const session = await this.client.call<SessionInfo>(
      RpcMethod.sessionsCreate,
      input,
    )
    await this.loadSessions(input.workspaceId)
    return session
  }

  async deleteSession(id: string): Promise<void> {
    const wsId = this.state.activeWorkspaceId
    await this.client.call<void>(RpcMethod.sessionsDelete, { id })
    if (this.state.activeSessionId === id) this.state.activeSessionId = null
    // Evict per-session state so deleted sessions don't accumulate.
    delete this.state.streaming[id]
    delete this.state.messagesBySession[id]
    delete this.state.lastUsage[id]
    if (wsId) await this.loadSessions(wsId)
  }

  async forkSession(id: string, uptoSeq?: number): Promise<SessionInfo> {
    const forked = await this.client.call<SessionInfo>(RpcMethod.sessionsFork, {
      id,
      uptoSeq,
    })
    const wsId = this.state.activeWorkspaceId
    if (wsId) await this.loadSessions(wsId)
    return forked
  }

  async openSession(id: string): Promise<void> {
    this.state.activeSessionId = id
    await this.loadMessages(id)
  }

  // ---- chat ----

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const st = this.ensureStreaming(sessionId)
    st.pendingSend = text
    try {
      await this.client.call<void>(RpcMethod.chatSend, { sessionId, text })
    } catch (err) {
      st.pendingSend = null
      st.status = "error"
      st.error = errMessage(err)
      throw err
    }
  }

  steer(sessionId: string, text: string): Promise<void> {
    return this.client.call<void>(RpcMethod.chatSteer, { sessionId, text })
  }

  followUp(sessionId: string, text: string): Promise<void> {
    return this.client.call<void>(RpcMethod.chatFollowUp, { sessionId, text })
  }

  abort(sessionId: string): Promise<void> {
    return this.client.call<void>(RpcMethod.chatAbort, { sessionId })
  }

  // ---- auth ----

  async loginApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.client.call<void>(RpcMethod.modelsLogin, { providerId, apiKey })
    await this.loadProviders()
  }

  async logout(providerId: string): Promise<void> {
    await this.client.call<void>(RpcMethod.modelsLogout, { providerId })
    await this.loadProviders()
  }

  // ---- plugins ----

  async addPlugin(input: {
    source: string
    scope?: "global" | "workspace"
    workspaceId?: string
    name?: string
  }): Promise<void> {
    await this.client.call(RpcMethod.pluginsAdd, input)
    await this.refreshPlugins()
  }

  async removePlugin(id: string): Promise<void> {
    await this.client.call(RpcMethod.pluginsRemove, { id })
    await this.refreshPlugins()
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    await this.client.call(RpcMethod.pluginsSetEnabled, { id, enabled })
    await this.refreshPlugins()
  }

  private async refreshPlugins(): Promise<void> {
    await this.loadPluginsGlobal()
    const wsId = this.state.activeWorkspaceId
    if (wsId) await this.loadPluginsForWorkspace(wsId)
  }

  // ---- settings ----

  async setDefaultModel(model: { provider: string; id: string }): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultModel",
      value: model,
    })
    this.state.settings.defaultModel = model
  }

  async setDefaultThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultThinkingLevel",
      value: level,
    })
    this.state.settings.defaultThinkingLevel = level
  }

  // ---- selectors ----

  messagesFor(sessionId: string): StoredMessage[] {
    return this.state.messagesBySession[sessionId] ?? []
  }

  streamingFor(sessionId: string): StreamingState {
    return this.ensureStreaming(sessionId)
  }

  /** Active session info or null. */
  get activeSession(): SessionInfo | null {
    const id = this.state.activeSessionId
    if (!id) return null
    return this.state.sessions.find((s) => s.id === id) ?? null
  }

  // ---- notification handlers ----

  private ensureStreaming(sessionId: string): StreamingState {
    let st = this.state.streaming[sessionId]
    if (!st) {
      st = emptyStreaming()
      this.state.streaming[sessionId] = st
    }
    return st
  }

  private async handleStatus(p: unknown): Promise<void> {
    const { sessionId, status, error } = p as {
      sessionId: string
      status: StreamingState["status"]
      error?: string
    }
    const st = this.ensureStreaming(sessionId)
    st.status = status
    st.error = error
    if (status === "running") {
      // New turn: reset buffers (idempotent across re-settles).
      st.textBuf = ""
      st.thinkingBuf = ""
      st.parts = []
      st.activeTool = null
    }
    // Reflect the status locally right away (no RPC); the persisted row only
    // changes at settle, so a real refetch happens there (see run_end).
    const local = this.state.sessions.find((s) => s.id === sessionId)
    if (local) {
      local.status = status
    }
    if (status !== "running") {
      this.maybeScheduleSessionsRefresh(sessionId)
    }
  }

  private handleDelta(p: unknown): void {
    const { sessionId, kind, delta } = p as {
      sessionId: string
      kind: "text" | "thinking"
      delta: string
    }
    const st = this.ensureStreaming(sessionId)
    if (kind === "text") st.textBuf += delta
    else st.thinkingBuf += delta
  }

  private handleToolStart(p: unknown): void {
    const { sessionId, toolCallId, toolName, args } = p as {
      sessionId: string
      toolCallId: string
      toolName: string
      args: unknown
    }
    const st = this.ensureStreaming(sessionId)
    // A tool boundary ends the current assistant message: freeze its streamed
    // content so multi-assistant turns render as separate segments instead of
    // one concatenated blob.
    if (st.textBuf || st.thinkingBuf) {
      st.parts.push({ text: st.textBuf, thinking: st.thinkingBuf })
      st.textBuf = ""
      st.thinkingBuf = ""
    }
    st.activeTool = { toolCallId, toolName, args }
  }

  private handleToolUpdate(p: unknown): void {
    const { sessionId, toolCallId, partialResult } = p as {
      sessionId: string
      toolCallId: string
      partialResult: unknown
    }
    const st = this.state.streaming[sessionId]
    if (st?.activeTool && st.activeTool.toolCallId === toolCallId) {
      st.activeTool.partialResult = partialResult
    }
  }

  private handleToolEnd(p: unknown): void {
    const { sessionId, toolCallId, result, isError } = p as {
      sessionId: string
      toolCallId: string
      result: unknown
      isError: boolean
    }
    const st = this.state.streaming[sessionId]
    if (st?.activeTool && st.activeTool.toolCallId === toolCallId) {
      st.activeTool.result = result
      st.activeTool.isError = isError
    }
  }

  private handleMessageEnd(p: unknown): void {
    const { sessionId, message } = p as {
      sessionId: string
      message: StoredMessage
    }
    const current = this.state.messagesBySession[sessionId]
    const list = current ?? []
    const idx = list.findIndex((m) => m.id === message.id)
    if (idx >= 0) list[idx] = message
    else list.push(message)
    if (!current) this.state.messagesBySession[sessionId] = list
    // The persisted assistant message supersedes the streaming placeholder.
    const st = this.state.streaming[sessionId]
    if (message.role === "assistant" && st) {
      st.textBuf = ""
      st.thinkingBuf = ""
    }
  }

  private async handleRunEnd(p: unknown): Promise<void> {
    const { sessionId, messages, usage, error } = p as {
      sessionId: string
      messages: StoredMessage[]
      usage: UsageSummary
      error?: string
    }
    // Reconcile by stable id: makes message_end + run_end idempotent and
    // supersedes any optimistic/pending UI state.
    const current = this.state.messagesBySession[sessionId] ?? []
    const byId = new Map(current.map((m) => [m.id, m]))
    for (const m of messages) byId.set(m.id, m)
    this.state.messagesBySession[sessionId] = [...byId.values()]

    // A re-settle of an already-persisted run pushes all-zero usage; don't let
    // it clobber the last real run's numbers.
    if (usage.totalTokens > 0 || this.state.lastUsage[sessionId] === undefined) {
      this.state.lastUsage[sessionId] = usage
    }
    const st = this.ensureStreaming(sessionId)
    st.pendingSend = null
    st.textBuf = ""
    st.thinkingBuf = ""
    st.parts = []
    st.activeTool = null
    st.error = error
    this.maybeScheduleSessionsRefresh(sessionId)
  }

  private async handleWorkspaceUpdated(p: unknown): Promise<void> {
    const { workspaceId } = p as { workspaceId: string }
    await this.loadWorkspaces()
    if (this.state.activeWorkspaceId === workspaceId) {
      this.state.activeWorkspaceId = null
      this.state.activeSessionId = null
      this.state.sessions = []
    }
    this.state.drafts = this.state.drafts.filter((d) => d.workspaceId !== workspaceId)
  }

  /** LLM auto-title landed: patch the row in place (no refetch needed). */
  private handleTitleUpdated(p: unknown): void {
    const { sessionId, title, updatedAt } = p as {
      sessionId: string
      title: string
      updatedAt?: number
    }
    const row = this.state.sessions.find((s) => s.id === sessionId)
    if (row) {
      row.title = title
      // Keep recency in sync with the server (updateTitle bumps updated_at).
      if (updatedAt) row.updatedAt = updatedAt
    }
  }

  /** Refetch the active workspace's sessions only if the session is in it. */
  private maybeScheduleSessionsRefresh(sessionId: string): void {
    const wsId = this.state.activeWorkspaceId
    if (!wsId) return
    const session = this.state.sessions.find((s) => s.id === sessionId)
    if (!session) return
    this.scheduleSessionsRefresh(wsId)
  }
}

export const StoreKey: InjectionKey<Store> = Symbol("my-pi-store")

export function useStore(): Store {
  const store = inject(StoreKey)
  if (!store) throw new Error("Store not provided; call app.provide(StoreKey, store)")
  return store
}
