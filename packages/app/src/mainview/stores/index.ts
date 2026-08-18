import { inject, type InjectionKey } from "vue"
import type { CreateSessionInput, SessionInfo } from "@my-pi/shared"
import type { RpcClient } from "../rpc/client"
import { createState, type AppState } from "./state"
import { ConnectionStore } from "./connectionStore"
import { WorkspaceStore } from "./workspaceStore"
import { SessionStore } from "./sessionStore"
import { ChatStore } from "./chatStore"
import { ModelStore } from "./modelStore"
import { SettingsStore } from "./settingsStore"
import { PluginStore } from "./pluginStore"

export type { AppState } from "./state"
export type {
  ActiveToolState,
  DraftSession,
  StreamedPart,
  StreamingState,
} from "./types"

/**
 * Root store: the composition root. It owns the shared reactive `state` and
 * the domain store instances, and it orchestrates the few cross-domain
 * workflows (refreshAll, openWorkspace, removeWorkspace, sendDraft). Most
 * operations are thin delegations to a single domain store, so consumers can
 * inject only the focused store they need via `useXStore()`.
 */
export class Store {
  readonly client: RpcClient
  readonly state: AppState
  readonly connection: ConnectionStore
  readonly workspaces: WorkspaceStore
  readonly sessions: SessionStore
  readonly chat: ChatStore
  readonly models: ModelStore
  readonly settings: SettingsStore
  readonly plugins: PluginStore

  constructor(client: RpcClient) {
    this.client = client
    this.state = createState()
    this.connection = new ConnectionStore(this.state, client)
    this.workspaces = new WorkspaceStore(this.state, client, this.connection)
    this.sessions = new SessionStore(this.state, client, this.connection)
    this.chat = new ChatStore(this.state, client, this.connection)
    this.models = new ModelStore(this.state, client, this.connection)
    this.settings = new SettingsStore(this.state, client, this.connection)
    this.plugins = new PluginStore(this.state, client, this.connection)

    // Streaming-settle / status changes should refresh the session list, and
    // session rows may live in any workspace's cache (multi-node expansion).
    this.chat.sessionsRefresh = (id) => this.sessions.scheduleForSession(id)
    this.chat.sessionLookup = (id) => this.sessions.sessionById(id)
    client.onRefreshAll = () => void this.refreshAll()

    // Opening a session makes its workspace active; lazy-load that
    // workspace's plugins, matching openWorkspace's behavior. (Drafts do not
    // switch the active workspace — only real session selection does.)
    this.sessions.onWorkspaceActivated = (workspaceId: string): void => {
      void this.loadPluginsForWorkspace(workspaceId).catch((err) => {
        this.state.error = err instanceof Error ? err.message : String(err)
      })
    }
  }

  /** Start the connection; `refreshAll()` runs on first connect. */
  init(): void {
    this.connection.init()
  }

  // ---- cross-domain workflows ----

  /**
   * Re-sync everything on (re)connect, including the active workspace's
   * sessions and the active session's transcript: runs that finished while
   * disconnected push no notifications to the new connection.
   */
  async refreshAll(): Promise<void> {
    // Refresh every workspace whose sessions are cached (expanded nodes), plus
    // the active workspace even if it was never expanded yet.
    const workspaceIds = new Set(Object.keys(this.state.sessionsByWorkspace))
    if (this.state.activeWorkspaceId) workspaceIds.add(this.state.activeWorkspaceId)
    await Promise.allSettled([
      this.loadWorkspaces(),
      this.loadProviders(),
      this.loadPluginsGlobal(),
      this.loadSettings(),
      this.connection.loadPersistedConnection(),
      ...[...workspaceIds].map((id) => this.loadSessions(id)),
      this.state.activeSessionId && !this.isDraft(this.state.activeSessionId)
        ? this.loadMessages(this.state.activeSessionId)
        : Promise.resolve(),
    ])
  }

  async openWorkspace(id: string): Promise<void> {
    this.state.activeSessionId = null
    // Re-point the active workspace and the flat alias immediately (the cache
    // may be empty until load resolves); the activation hook lazy-loads the
    // workspace's plugins.
    this.sessions.setActiveWorkspace(id)
    await this.loadSessions(id)
  }

  async removeWorkspace(id: string): Promise<void> {
    await this.workspaces.removeWorkspaceRpc(id)
    // The server also emits workspace.updated on removal, so the event handler
    // performs the same cleanup; the explicit teardown here is an idempotent
    // safety net for when the event hasn't landed yet.
    if (this.state.activeWorkspaceId === id) {
      this.state.activeWorkspaceId = null
      this.state.activeSessionId = null
      this.state.sessions = []
    }
    delete this.state.sessionsByWorkspace[id]
    this.workspaces.clearDraftsOfWorkspace(id)
    await this.workspaces.loadWorkspacesRpc()
  }

  /**
   * First message of a draft: create the real session server-side (autoTitle
   * so the LLM names it after this run), then send the prompt. The draft is
   * replaced by the persisted session node (createSession refetches the list).
   */
  async sendDraft(localId: string, text: string): Promise<void> {
    const draft = this.state.drafts.find((d) => d.localId === localId)
    if (!draft) throw new Error("Draft session not found")
    // A draft's session is created with the chat model. Bail before
    // converting the draft so the composer stays put (message intact) instead
    // of stranding the user on an empty real session with no model to run.
    const chatModel = this.state.settings.chatModel
    if (!chatModel) {
      throw new Error(
        "No model configured. Choose a chat model in Settings before starting a session.",
      )
    }
    const session = await this.createSession({
      workspaceId: draft.workspaceId,
      autoTitle: true,
      model: chatModel,
    })
    this.state.drafts = this.state.drafts.filter((d) => d.localId !== localId)
    await this.openSession(session.id)
    await this.sendMessage(session.id, text)
  }

  // ---- workspaces / drafts ----

  loadWorkspaces(): Promise<void> {
    return this.workspaces.load()
  }
  pickFolder(): Promise<string | null> {
    return this.workspaces.pickFolder()
  }
  createWorkspace(name: string, path: string) {
    return this.workspaces.createWorkspace(name, path)
  }
  startDraft(workspaceId: string): string {
    return this.workspaces.startDraft(workspaceId)
  }
  openDraft(localId: string): void {
    this.workspaces.openDraft(localId)
  }
  discardDraft(localId: string): void {
    this.workspaces.discardDraft(localId)
  }
  isDraft(id: string): boolean {
    return this.workspaces.isDraft(id)
  }

  // ---- sessions ----

  loadSessions(workspaceId: string): Promise<void> {
    return this.sessions.load(workspaceId)
  }
  loadMessages(sessionId: string): Promise<void> {
    return this.sessions.loadMessages(sessionId)
  }
  createSession(input: CreateSessionInput): Promise<SessionInfo> {
    return this.sessions.createSession(input)
  }
  deleteSession(id: string): Promise<void> {
    return this.sessions.deleteSession(id)
  }
  forkSession(id: string, uptoSeq?: number): Promise<SessionInfo> {
    return this.sessions.forkSession(id, uptoSeq)
  }
  openSession(id: string): Promise<void> {
    return this.sessions.openSession(id)
  }
  updateSessionModel(
    id: string,
    model: { provider: string; id: string },
  ): Promise<SessionInfo> {
    return this.sessions.updateModel(id, model)
  }

  // ---- chat ----

  sendMessage(sessionId: string, text: string): Promise<void> {
    return this.chat.sendMessage(sessionId, text)
  }
  steer(sessionId: string, text: string): Promise<void> {
    return this.chat.steer(sessionId, text)
  }
  followUp(sessionId: string, text: string): Promise<void> {
    return this.chat.followUp(sessionId, text)
  }
  abort(sessionId: string): Promise<void> {
    return this.chat.abort(sessionId)
  }

  // ---- models / auth ----

  loadProviders(): Promise<void> {
    return this.models.loadProviders()
  }
  listModels(providerId: string) {
    return this.models.listModels(providerId)
  }
  loginApiKey(providerId: string, apiKey: string): Promise<void> {
    return this.models.loginApiKey(providerId, apiKey)
  }
  logout(providerId: string): Promise<void> {
    return this.models.logout(providerId)
  }

  // ---- plugins ----

  loadPluginsGlobal(): Promise<void> {
    return this.plugins.loadGlobal()
  }
  loadPluginsForWorkspace(workspaceId: string): Promise<void> {
    return this.plugins.loadForWorkspace(workspaceId)
  }
  addPlugin(input: {
    source: string
    scope?: "global" | "workspace"
    workspaceId?: string
    name?: string
  }): Promise<void> {
    return this.plugins.add(input)
  }
  removePlugin(id: string): Promise<void> {
    return this.plugins.remove(id)
  }
  setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    return this.plugins.setEnabled(id, enabled)
  }

  // ---- settings ----

  loadSettings(): Promise<void> {
    return this.settings.load()
  }
  applyConnection(config: {
    endpoint: string
    token: string
  }): Promise<void> {
    return this.connection.applyConnection(config)
  }
  setDefaultModel(model: { provider: string; id: string }): Promise<void> {
    return this.settings.setDefaultModel(model)
  }
  setChatModel(model: { provider: string; id: string } | null): Promise<void> {
    return this.settings.setChatModel(model)
  }
  setTitleModel(model: { provider: string; id: string } | null): Promise<void> {
    return this.settings.setTitleModel(model)
  }
  setDefaultThinkingLevel(level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"): Promise<void> {
    return this.settings.setDefaultThinkingLevel(level)
  }

  // ---- selectors ----

  messagesFor(sessionId: string) {
    return this.state.messagesBySession[sessionId] ?? []
  }

  streamingFor(sessionId: string) {
    return this.chat.streamingFor(sessionId)
  }

  /** Active session info or null. */
  get activeSession(): SessionInfo | null {
    const id = this.state.activeSessionId
    if (!id) return null
    return this.state.sessions.find((s) => s.id === id) ?? null
  }
}

export const StoreKey: InjectionKey<Store> = Symbol("my-pi-store")

export function useStore(): Store {
  const store = inject(StoreKey)
  if (!store) throw new Error("Store not provided; call app.provide(StoreKey, store)")
  return store
}

// ---- focused store accessors (interface segregation) ----
// Each returns the typed domain store from the injected root. Consumers depend
// only on the focused surface they read, not the whole god store.

export function useConnectionStore(): ConnectionStore {
  return useStore().connection
}
export function useWorkspaceStore(): WorkspaceStore {
  return useStore().workspaces
}
export function useSessionStore(): SessionStore {
  return useStore().sessions
}
export function useChatStore(): ChatStore {
  return useStore().chat
}
export function useModelStore(): ModelStore {
  return useStore().models
}
export function useSettingsStore(): SettingsStore {
  return useStore().settings
}
export function usePluginStore(): PluginStore {
  return useStore().plugins
}
