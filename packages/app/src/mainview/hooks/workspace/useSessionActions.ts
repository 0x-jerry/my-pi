import type { SessionInfo } from "@my-pi/shared"
import { useSessionStore } from "../../stores"
import { showError } from "../shared/useErrors"
import { confirmAction } from "../shared/useConfirm"

/** Session-level actions: open / fork / delete. */
export function useSessionActions() {
  const sessions = useSessionStore()

  async function openSession(s: SessionInfo): Promise<void> {
    try {
      await sessions.openSession(s.id)
    } catch (err) {
      showError(err)
    }
  }

  async function fork(s: SessionInfo): Promise<void> {
    try {
      const forked = await sessions.forkSession(s.id)
      await sessions.openSession(forked.id)
    } catch (err) {
      showError(err)
    }
  }

  async function removeSession(s: SessionInfo): Promise<void> {
    const confirmed = await confirmAction({
      title: "Delete session",
      message: `Delete session "${s.title}"?`,
      confirmButtonText: "Delete",
      cancelButtonText: "Cancel",
    })
    if (!confirmed) return
    try {
      await sessions.deleteSession(s.id)
    } catch (err) {
      showError(err)
    }
  }

  return { openSession, fork, removeSession }
}
