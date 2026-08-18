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
    this.state.sessions = await this.client.call(
      RpcMethod.sessionsList,
      { workspaceId },
    )
  }

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
    const wsId = this.state.activeWorkspaceId
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
    const wsId = this.state.activeWorkspaceId
    if (wsId) await this.load(wsId)
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
    const idx = this.state.sessions.findIndex((s) => s.id === id)
    if (idx !== -1) this.state.sessions[idx] = updated
    return updated
  }

  async openSession(id: string): Promise<void> {
    this.state.activeSessionId = id
    await this.loadMessages(id)
  }

  // ---- refresh scheduling ----

  private sessionsRefreshQueued = false

  /** Debounced (per-microtask) refetch of a workspace's session list. */
  private scheduleSessionsRefresh(workspaceId: string): void {
    if (this.sessionsRefreshQueued) return
    this.sessionsRefreshQueued = true
    queueMicrotask(() => {
      this.sessionsRefreshQueued = false
      void this.load(workspaceId).catch((err) => {
        this.state.error = err instanceof Error ? err.message : String(err)
      })
    })
  }

  /** Refetch the active workspace's sessions only if the session is in it. */
  scheduleForSession(sessionId: string): void {
    const wsId = this.state.activeWorkspaceId
    if (!wsId) return
    const session = this.state.sessions.find((s) => s.id === sessionId)
    if (!session) return
    this.scheduleSessionsRefresh(wsId)
  }
}
