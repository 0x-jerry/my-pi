import { reactive } from "vue"
import { RpcEvent, RpcMethod, type RpcNotifications, type Workspace } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { DraftSession } from "./types"
import type { RpcClient } from "../rpc/client"

/**
 * Workspace slice: the workspace list and the local draft placeholders.
 * Owned by WorkspaceStore.
 */
function createWorkspaceState() {
  return reactive({
    workspaces: [] as Workspace[],
    drafts: [] as DraftSession[],
  })
}
export type WorkspaceStateSlice = ReturnType<typeof createWorkspaceState>

/**
 * Workspace domain: loading the workspace list, creating a workspace from a
 * picked folder, plus the local draft placeholders. Removing/opening
 * workspaces spans other domains (sessions, plugins), so those workflows live
 * in the root facade; this store provides the single-domain primitives.
 */
export class WorkspaceStore {
  private readonly client: RpcClient
  readonly state: WorkspaceStateSlice

  /**
   * Injected by the root facade: a workspace was confirmed removed (list
   * re-fetched and the id is gone) — the root tears down session selection,
   * caches, chat state and drafts across the owning stores.
   */
  onWorkspaceRemoved?: (workspaceId: string) => void

  constructor(client: RpcClient, connection: ConnectionStore) {
    this.state = createWorkspaceState()
    this.client = client
    connection.on(RpcEvent.workspaceUpdated, (p) => this.handleWorkspaceUpdated(p))
  }

  async load(): Promise<void> {
    this.state.workspaces = await this.client.call(RpcMethod.workspacesList)
  }

  /** Open the shell's native folder picker; resolves to a path or null. */
  async pickFolder(): Promise<string | null> {
    return this.client.call(RpcMethod.dialogsPickFolder)
  }

  async createWorkspace(name: string, path: string): Promise<Workspace> {
    const ws = await this.client.call(RpcMethod.workspacesCreate, {
      name,
      path,
    })
    await this.load()
    return ws
  }

  async removeWorkspaceRpc(id: string): Promise<void> {
    await this.client.call(RpcMethod.workspacesRemove, { id })
  }

  // ---- drafts (placeholder sessions created via the tree "+") ----

  private draftSeq = 0

  /** Add a local placeholder node; the server session appears on first message. */
  startDraft(workspaceId: string): string {
    const localId = `draft:${++this.draftSeq}:${Date.now()}`
    this.state.drafts.push({ localId, workspaceId })
    return localId
  }

  isDraft(id: string): boolean {
    return this.state.drafts.some((d) => d.localId === id)
  }

  /** Drop a local placeholder from the list (no server call, no selection). */
  removeDraft(localId: string): void {
    this.state.drafts = this.state.drafts.filter((d) => d.localId !== localId)
  }

  /** Drop all drafts that belong to a workspace (after it is removed). */
  clearDraftsOfWorkspace(workspaceId: string): void {
    this.state.drafts = this.state.drafts.filter(
      (d) => d.workspaceId !== workspaceId,
    )
  }

  private async handleWorkspaceUpdated(
    p: RpcNotifications["workspace.updated"],
  ): Promise<void> {
    const { workspaceId } = p
    // Await the reload before tearing down the active selection so the tree
    // shows the refreshed list and a failed reload leaves active state intact
    // (matches the original await-first behaviour).
    await this.load()
    // Today the server only emits workspace.updated on removal; if the
    // workspace is still present (future rename/reindex events) keep its
    // tree, session cache and drafts intact.
    if (this.state.workspaces.some((w) => w.id === workspaceId)) return
    this.onWorkspaceRemoved?.(workspaceId)
  }
}
