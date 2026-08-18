import { computed } from "vue"
import { useSessionStore, useWorkspaceStore } from "../../stores"

/**
 * Active chat selection for the home chat page: which session (if any) is
 * active, and whether it is a local draft placeholder rather than a persisted
 * session (which decides between DraftChat and the full ChatView).
 */
export function useActiveChat() {
  const sessions = useSessionStore()
  const workspaces = useWorkspaceStore()

  const activeSessionId = computed(() => sessions.state.activeSessionId)
  const isDraft = computed(
    () => activeSessionId.value !== null && workspaces.isDraft(activeSessionId.value),
  )

  return { activeSessionId, isDraft }
}
