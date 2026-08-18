import { ref } from "vue"
import { useStore } from "../../store"
import { showError } from "../shared/useErrors"

/**
 * Composer behavior for a draft (placeholder) session: sends the first message,
 * which creates the real session server-side, opens it, and sends the prompt.
 */
export function useDraftChat(getDraftId: () => string | null) {
  const store = useStore()

  const input = ref("")
  const sending = ref(false)

  async function send(): Promise<void> {
    const text = input.value.trim()
    if (!text || sending.value || !getDraftId()) return
    sending.value = true
    input.value = ""
    try {
      await store.sendDraft(getDraftId() as string, text)
    } catch (err) {
      input.value = text
      showError(err)
    } finally {
      sending.value = false
    }
  }

  return { input, sending, send }
}
