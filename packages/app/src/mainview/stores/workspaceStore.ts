import { RpcEvent, RpcMethod, type Workspace } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Workspace domain: loading the workspace list, creating a workspace from a
 * picked folder, plus the local draft placeholders. Removing/opening
 * workspaces spans other domains (sessions, plugins), so those workflows live
 * in the root facade; this store provides the single-domain primitives.
 */
export class WorkspaceStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, connection: ConnectionStore) {
    this.state = state
    this.client = client
    connection.on(RpcEvent.workspaceUpdated, (p) => this.handleWorkspaceUpdated(p))
  }

  async load(): Promise<void> {
    this.state.workspaces = await this.client.call<Workspace[]>(
      RpcMethod.workspacesList,
      {},
    )
  }

  /** Open the shell's native folder picker; resolves to a path or null. */
  async pickFolder(): Promise<string | null> {
    return this.client.call<string | null>(RpcMethod.dialogsPickFolder)
  }

  async createWorkspace(name: string, path: string): Promise<Workspace> {
    const ws = await this.client.call<Workspace>(RpcMethod.workspacesCreate, {
      name,
      path,
    })
    await this.load()
    return ws
  }

  async removeWorkspaceRpc(id: string): Promise<void> {
    await this.client.call<void>(RpcMethod.workspacesRemove, { id })
  }

  async loadWorkspacesRpc(): Promise<void> {
    await this.load()
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

  /** Drop all drafts that belong to a workspace (after it is removed). */
  clearDraftsOfWorkspace(workspaceId: string): void {
    this.state.drafts = this.state.drafts.filter(
      (d) => d.workspaceId !== workspaceId,
    )
  }

  clearDrafts(): void {
    this.state.drafts = []
  }

  private async handleWorkspaceUpdated(p: unknown): Promise<void> {
    const { workspaceId } = p as { workspaceId: string }
    // Await the reload before tearing down the active selection so the tree
    // shows the refreshed list and a failed reload leaves active state intact
    // (matches the original await-first behaviour).
    await this.load()
    if (this.state.activeWorkspaceId === workspaceId) {
      this.state.activeWorkspaceId = null
      this.state.activeSessionId = null
      this.state.sessions = []
    }
    this.clearDraftsOfWorkspace(workspaceId)
  }
}
