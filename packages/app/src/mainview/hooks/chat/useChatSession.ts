import { computed, ref } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import { useChatStore, useSessionStore } from "../../stores"

/**
 * Behavior for the chat composer + transcript: derives session/message/stream
 * state from the store and exposes the send / steer / follow-up / abort / fork
 * actions. Keeps its own local `input`, `busy` and transient `actionError`
 * refs so the presenting component stays purely declarative.
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

  async function send(): Promise<void> {
    const text = input.value.trim()
    if (!text || running.value) return
    actionError.value = null
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

  async function steer(): Promise<void> {
    const text = input.value.trim()
    if (!text) return
    actionError.value = null
    try {
      await chat.steer(getSessionId(), text)
      input.value = ""
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function followUp(): Promise<void> {
    const text = input.value.trim()
    if (!text) return
    actionError.value = null
    try {
      await chat.followUp(getSessionId(), text)
      input.value = ""
    } catch (err) {
      actionError.value = err instanceof Error ? err.message : String(err)
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

  async function forkLatest(): Promise<void> {
    actionError.value = null
    try {
      const forked = await sessions.forkSession(getSessionId())
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
    send,
    steer,
    followUp,
    abort,
    forkHere,
    forkLatest,
  }
}
