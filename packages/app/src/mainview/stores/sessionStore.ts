import { RpcMethod, type CreateSessionInput, type SessionInfo } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Session domain: listing a workspace's sessions, opening/forking/deleting
 * sessions, loading transcripts, and debounced session-list refresh. The
 * draft→first-message workflow (`sendDraft`) is orchestrated by the root
 * facade because it spans sessions + chat.
 */
export class SessionStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
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
      this.state.workspaces.length > 0 &&
      !this.state.workspaces.some((w) => w.id === workspaceId)
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

  /**
   * Optional hook fired when opening a session switches the active workspace
   * (e.g. lazy-load that workspace's plugins). Wired by the root facade.
   */
  onWorkspaceActivated?: (workspaceId: string) => void

  /** Fetch (or re-fetch) the transcript for one session into the store. */
  async loadMessages(sessionId: string): Promise<void> {
    this.state.messagesBySession[sessionId] =
      await this.client.call(RpcMethod.sessionsMessages, {
        id: sessionId,
      })
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
    // Evict per-session state so deleted sessions don't accumulate.
    delete this.state.streaming[id]
    delete this.state.messagesBySession[id]
    delete this.state.lastUsage[id]
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
        this.state.error = err instanceof Error ? err.message : String(err)
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
