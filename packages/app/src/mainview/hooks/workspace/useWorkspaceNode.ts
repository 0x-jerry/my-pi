import type { Workspace } from "@my-pi/shared"
import { useStore } from "../../store"
import { showError } from "../shared/useErrors"
import { confirmAction } from "../shared/useConfirm"

/** Workspace-level actions: open / remove / start a new session. */
export function useWorkspaceNode() {
  const store = useStore()

  async function open(ws: Workspace): Promise<void> {
    try {
      await store.openWorkspace(ws.id)
    } catch (err) {
      showError(err)
    }
  }

  async function remove(ws: Workspace): Promise<void> {
    const confirmed = await confirmAction({
      title: "Remove workspace",
      message: `Remove workspace "${ws.name}"?\nAll sessions and messages will be deleted.`,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
    })
    if (!confirmed) return
    try {
      await store.removeWorkspace(ws.id)
    } catch (err) {
      showError(err)
    }
  }

  /**
   * Start a new session: the + icon adds a local "New session" placeholder
   * node and opens its composer. The real session is created server-side only
   * when the first message is sent (see store.sendDraft).
   */
  async function newSession(ws: Workspace): Promise<void> {
    if (store.sessions.state.activeWorkspaceId !== ws.id) {
      try {
        await store.openWorkspace(ws.id)
      } catch (err) {
        showError(err)
        return
      }
    }
    store.sessions.openDraft(store.workspaces.startDraft(ws.id))
  }

  return { open, remove, newSession }
}
