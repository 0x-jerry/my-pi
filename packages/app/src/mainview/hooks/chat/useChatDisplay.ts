import { ref } from "vue"

/**
 * UI-local state for collapsing/expanding the "thinking" block of each
 * persisted assistant message. Pure presentation state — no store access.
 */
export function useChatDisplay() {
  const collapsedThinking = ref<Set<string>>(new Set())

  function toggleThinking(msgId: string): void {
    const next = new Set(collapsedThinking.value)
    if (next.has(msgId)) next.delete(msgId)
    else next.add(msgId)
    collapsedThinking.value = next
  }

  function isCollapsed(msgId: string): boolean {
    return collapsedThinking.value.has(msgId)
  }

  return { toggleThinking, isCollapsed }
}
