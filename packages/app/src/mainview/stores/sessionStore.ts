import { reactive } from "vue"
import {
  RpcMethod,
  type CreateSessionInput,
  type SessionInfo,
  type StoredMessage,
} from "@my-pi/shared"
import type { WorkspaceStore } from "./workspaceStore"
import type { RpcClient } from "../rpc/client"

/**
 * Session slice: per-workspace session caches, the flat alias of the active
 * workspace's list, the active selection, and transcripts. Owned by
 * SessionStore.
 */
function createSessionState() {
  return reactive({
    sessionsByWorkspace: {} as Record<string, SessionInfo[]>,
    sessions: [] as SessionInfo[],
    activeWorkspaceId: null as string | null,
    activeSessionId: null as string | null,
    messagesBySession: {} as Record<string, StoredMessage[]>,
  })
}
export type SessionStateSlice = ReturnType<typeof createSessionState>

/**
 * Session domain: listing a workspace's sessions, opening/forking/deleting
 * sessions, loading transcripts, the active selection (workspace + session)
 * and the flat `sessions` alias of the active workspace's cached list.
 * Debounced session-list refresh lives here too.
 *
 * The chat store's notification handlers write transcripts through this
 * store's `upsertMessage`/`reconcileMessages` primitives, and per-session
 * chat state (streaming/usage) is evicted via the `onSessionEvicted` hook
 * wired by the root facade — each slice has exactly one owner.
 */
export class SessionStore {
  private readonly client: RpcClient
  private readonly workspaces: WorkspaceStore
  readonly state: SessionStateSlice

  /**
   * Optional hooks wired by the root facade (kept as fields so construction
   * order never forms a cycle):
   * - `onWorkspaceActivated` fires when opening a session switches the active
   *   workspace (e.g. lazy-load that workspace's plugins).
   * - `onSessionEvicted` drops the chat store's per-session state when a
   *   session is deleted or its workspace is removed.
   */
  onWorkspaceActivated?: (workspaceId: string) => void
  onSessionEvicted?: (sessionId: string) => void

  /** Injected by the root facade: surface async-load errors into the global banner. */
  setError: (message: string) => void = () => {}

  constructor(client: RpcClient, workspaces: WorkspaceStore) {
    this.state = createSessionState()
    this.client = client
    this.workspaces = workspaces
  }

  async load(workspaceId: string): Promise<void> {
    const list = await this.client.call(
      RpcMethod.sessionsList,
      { workspaceId },
    )
    // The workspace may have been removed while the RPC was in flight; don't
    // resurrect its cache entry. Only skip when the list is known to be
    // loaded (never-loaded lists, e.g. in unit tests, are trusted).
    if (
      this.workspaces.state.workspaces.length > 0 &&
      !this.workspaces.state.workspaces.some((w) => w.id === workspaceId)
    ) {
      return
    }
    // Per-workspace cache so several tree nodes can stay expanded at once.
    this.state.sessionsByWorkspace[workspaceId] = list
    // Keep the flat alias (read by chat/header consumers) in sync when this
    // is the active workspace. Same array reference, so in-place patches to
    // the alias also update the cache.
    if (this.state.activeWorkspaceId === workspaceId) {
      this.state.sessions = list
    }
  }

  /** Sessions of one workspace from the per-workspace cache (lazily loaded). */
  sessionsFor(workspaceId: string): SessionInfo[] {
    return this.state.sessionsByWorkspace[workspaceId] ?? []
  }

  /** Look up a session by id across the caches, then the flat alias. */
  sessionById(id: string): SessionInfo | null {
    for (const list of Object.values(this.state.sessionsByWorkspace)) {
      const found = list.find((s) => s.id === id)
      if (found) return found
    }
    // The alias may hold rows written directly (tests, in-flight loads).
    return this.state.sessions.find((s) => s.id === id) ?? null
  }

  /** Fetch (or re-fetch) the transcript for one session into the store. */
  async loadMessages(sessionId: string): Promise<void> {
    this.state.messagesBySession[sessionId] =
      await this.client.call(RpcMethod.sessionsMessages, {
        id: sessionId,
      })
  }

  /** Messages of one session from the transcripts cache (empty when unloaded). */
  messagesFor(sessionId: string): StoredMessage[] {
    return this.state.messagesBySession[sessionId] ?? []
  }

  /**
   * Transcript write primitive used by the chat store's `message_end` handler:
   * append or replace a message by stable id (idempotent).
   */
  upsertMessage(sessionId: string, message: StoredMessage): void {
    const list = this.state.messagesBySession[sessionId] ?? []
    const idx = list.findIndex((m) => m.id === message.id)
    if (idx >= 0) list[idx] = message
    else list.push(message)
    if (!this.state.messagesBySession[sessionId]) {
      this.state.messagesBySession[sessionId] = list
    }
  }

  /**
   * Transcript write primitive used by the chat store's `run_end` handler:
   * reconcile by stable id, superseding any optimistic/pending UI state.
   */
  reconcileMessages(sessionId: string, messages: StoredMessage[]): void {
    const current = this.state.messagesBySession[sessionId] ?? []
    const byId = new Map(current.map((m) => [m.id, m]))
    for (const m of messages) byId.set(m.id, m)
    this.state.messagesBySession[sessionId] = [...byId.values()]
  }

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const session = await this.client.call(
      RpcMethod.sessionsCreate,
      input,
    )
    await this.load(input.workspaceId)
    return session
  }

  async deleteSession(id: string): Promise<void> {
    // Refresh the session's own workspace list (may differ from the active
    // one when several tree nodes are expanded).
    const session = this.sessionById(id)
    const wsId = session?.workspaceId ?? this.state.activeWorkspaceId
    await this.client.call(RpcMethod.sessionsDelete, { id })
    if (this.state.activeSessionId === id) this.state.activeSessionId = null
    // Evict per-session state so deleted sessions don't accumulate: chat
    // state via the hook, transcripts are owned here.
    this.onSessionEvicted?.(id)
    delete this.state.messagesBySession[id]
    if (wsId) await this.load(wsId)
  }

  async forkSession(id: string, uptoSeq?: number): Promise<SessionInfo> {
    const forked = await this.client.call(RpcMethod.sessionsFork, {
      id,
      uptoSeq,
    })
    if (forked.workspaceId) await this.load(forked.workspaceId)
    return forked
  }

  /** Persist a per-session model override chosen in the chat header. */
  async updateModel(
    id: string,
    model: { provider: string; id: string },
  ): Promise<SessionInfo> {
    const updated = await this.client.call(
      RpcMethod.sessionsUpdateModel,
      { id, model },
    )
    const wsId = this.sessionById(id)?.workspaceId
    const list = wsId ? this.state.sessionsByWorkspace[wsId] : undefined
    if (list) {
      const idx = list.findIndex((s) => s.id === id)
      if (idx !== -1) list[idx] = updated
    }
    return updated
  }

  /**
   * Make `workspaceId` the active workspace: re-points the flat `state.sessions`
   * alias at that workspace's cached list and fires the activation hook.
   */
  setActiveWorkspace(workspaceId: string): void {
    this.state.activeWorkspaceId = workspaceId
    this.state.sessions = this.state.sessionsByWorkspace[workspaceId] ?? []
    this.onWorkspaceActivated?.(workspaceId)
  }

  async openSession(id: string): Promise<void> {
    // The active workspace follows the session being opened: with several
    // tree nodes expanded, the session's workspace may differ from the
    // currently active one, and acting on it should make it active.
    const session = this.sessionById(id)
    if (session && session.workspaceId !== this.state.activeWorkspaceId) {
      this.setActiveWorkspace(session.workspaceId)
    }
    this.state.activeSessionId = id
    await this.loadMessages(id)
  }

  /**
   * Teardown after a workspace is removed: drop the session cache and the
   * selection if it pointed at this workspace, and evict the chat store's
   * per-session state for every session that lived in it.
   */
  clearWorkspace(workspaceId: string): void {
    const list = this.state.sessionsByWorkspace[workspaceId]
    if (list) {
      for (const s of list) {
        // Evict the chat store's streaming/usage and our own transcripts so
        // a removed workspace's per-session state never accumulates.
        this.onSessionEvicted?.(s.id)
        delete this.state.messagesBySession[s.id]
      }
    }
    if (this.state.activeWorkspaceId === workspaceId) {
      this.state.activeWorkspaceId = null
      this.state.activeSessionId = null
      this.state.sessions = []
    }
    delete this.state.sessionsByWorkspace[workspaceId]
  }

  // ---- draft selection ----
  // The draft list itself lives in the workspace store; selecting / discarding
  // a draft is session-selection state, so those mutations live here.

  /** Select a draft node without any server transcript load. */
  openDraft(localId: string): void {
    if (!this.workspaces.isDraft(localId)) return
    this.state.activeSessionId = localId
  }

  /** Drop a local placeholder (no server call) and clear the selection. */
  discardDraft(localId: string): void {
    this.workspaces.removeDraft(localId)
    if (this.state.activeSessionId === localId) this.state.activeSessionId = null
  }

  // ---- refresh scheduling ----

  private sessionsRefreshPending = new Set<string>()

  /** Debounced (per-microtask) refetch of a workspace's session list. */
  private scheduleSessionsRefresh(workspaceId: string): void {
    // Track pending workspace ids (not a single boolean) so concurrent
    // settles in different workspaces each trigger their own refresh.
    if (this.sessionsRefreshPending.has(workspaceId)) return
    this.sessionsRefreshPending.add(workspaceId)
    queueMicrotask(() => {
      this.sessionsRefreshPending.delete(workspaceId)
      void this.load(workspaceId).catch((err) => {
        this.setError(err instanceof Error ? err.message : String(err))
      })
    })
  }

  /** Refetch the session's own workspace list (any expanded node stays fresh). */
  scheduleForSession(sessionId: string): void {
    const session = this.sessionById(sessionId)
    if (!session) return
    this.scheduleSessionsRefresh(session.workspaceId)
  }
}
