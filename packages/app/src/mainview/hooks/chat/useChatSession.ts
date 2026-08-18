import { computed, ref } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import { useChatStore, useSessionStore } from "../../stores"

/**
 * Behavior for the chat composer + transcript: derives session/message/stream
 * state from the store and exposes the submit / abort / fork actions. Keeps
 * its own local `input`, `busy` and transient `actionError` refs so the
 * presenting component stays purely declarative.
 *
 * Submit semantics (Enter in the composer): when a run is processing the new
 * message is sent as a steer (interrupting the running agent); otherwise it
 * starts a fresh send. A send that is still in flight (`busy`) is ignored so
 * we never steer an agent that hasn't loaded yet.
 */
export function useChatSession(getSessionId: () => string) {
  const chat = useChatStore()
  const sessions = useSessionStore()

  const input = ref("")
  const busy = ref(false)
  const actionError = ref<string | null>(null)

  const session = computed(() =>
    sessions.state.sessions.find((s) => s.id === getSessionId()),
  )
  const messages = computed(() => sessions.state.messagesBySession[getSessionId()] ?? [])
  const streaming = computed(() => chat.streamingFor(getSessionId()))
  const running = computed(() => streaming.value.status === "running" || busy.value)
  const usage = computed(() => chat.state.lastUsage[getSessionId()])

  const streamText = computed(() => streaming.value.textBuf)
  const streamThinking = computed(() => streaming.value.thinkingBuf)

  /** Enter-to-send: steer while running, otherwise send. */
  async function submit(): Promise<void> {
    const text = input.value.trim()
    if (!text || busy.value) return
    actionError.value = null
    if (running.value) {
      try {
        await chat.steer(getSessionId(), text)
        input.value = ""
      } catch (err) {
        actionError.value = err instanceof Error ? err.message : String(err)
      }
      return
    }
    busy.value = true
    input.value = ""
    try {
      await chat.sendMessage(getSessionId(), text)
    } catch (err) {
      input.value = text
      actionError.value = err instanceof Error ? err.message : String(err)
    } finally {
      busy.value = false
    }
  }

  async function abort(): Promise<void> {
    actionError.value = null
    try {
      await chat.abort(getSessionId())
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function forkHere(msg: StoredMessage): Promise<void> {
    actionError.value = null
    try {
      const forked = await sessions.forkSession(getSessionId(), msg.seq)
      await sessions.openSession(forked.id)
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    session,
    messages,
    streaming,
    running,
    usage,
    input,
    busy,
    actionError,
    streamText,
    streamThinking,
    submit,
    abort,
    forkHere,
  }
}
