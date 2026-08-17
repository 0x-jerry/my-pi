<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import { messageError, renderStoredMessage } from "../utils/render"
import { fmtUsage, jsonArgs } from "../utils/format"
import IconFork from "~icons/hugeicons/fork"
import IconSteering from "~icons/hugeicons/steering"
import IconArrowRight from "~icons/hugeicons/arrow-right-01"
import IconStop from "~icons/hugeicons/stop"
import IconTelegram from "~icons/hugeicons/telegram"
import { useStore, type StreamingState } from "../store"

const props = defineProps<{ sessionId: string }>()

const store = useStore()

const input = ref("")
const busy = ref(false)
const actionError = ref<string | null>(null)
const scroller = ref<HTMLElement | null>(null)
const collapsedThinking = ref<Set<string>>(new Set())

const session = computed(() =>
  store.state.sessions.find((s) => s.id === props.sessionId),
)
const messages = computed(() => store.messagesFor(props.sessionId))
const streaming = computed<StreamingState>(() => store.streamingFor(props.sessionId))
const running = computed(
  () => streaming.value.status === "running" || busy.value,
)
const usage = computed(() => store.state.lastUsage[props.sessionId])

const streamText = computed(() => streaming.value.textBuf)
const streamThinking = computed(() => streaming.value.thinkingBuf)

watch(
  () => [messages.value.length, streamText.value, streamThinking.value],
  () => {
    void nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    })
  },
)

async function send() {
  const text = input.value.trim()
  if (!text || running.value) return
  actionError.value = null
  busy.value = true
  input.value = ""
  try {
    await store.sendMessage(props.sessionId, text)
  } catch (err) {
    input.value = text
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

async function steer() {
  const text = input.value.trim()
  if (!text) return
  actionError.value = null
  try {
    await store.steer(props.sessionId, text)
    input.value = ""
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

async function followUp() {
  const text = input.value.trim()
  if (!text) return
  actionError.value = null
  try {
    await store.followUp(props.sessionId, text)
    input.value = ""
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

async function abort() {
  actionError.value = null
  try {
    await store.abort(props.sessionId)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

async function forkHere(msg: StoredMessage) {
  actionError.value = null
  try {
    const forked = await store.forkSession(props.sessionId, msg.seq)
    await store.openSession(forked.id)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

async function forkLatest() {
  actionError.value = null
  try {
    const forked = await store.forkSession(props.sessionId)
    await store.openSession(forked.id)
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  }
}

function toggleThinking(msgId: string) {
  const next = new Set(collapsedThinking.value)
  if (next.has(msgId)) next.delete(msgId)
  else next.add(msgId)
  collapsedThinking.value = next
}

function isCollapsed(msgId: string): boolean {
  return collapsedThinking.value.has(msgId)
}

function msgModel(msg: StoredMessage): string {
  return msg.model ?? ""
}
</script>

<template>
  <section class="chat">
    <header class="chat-head">
      <div class="chat-title">
        <h2>{{ session?.title ?? "Session" }}</h2>
        <span class="chat-model">{{ session?.modelId ?? "no model" }}</span>
      </div>
      <el-button
        v-if="messages.length > 0"
        text
        :icon="IconFork"
        @click="forkLatest"
      >
        Fork at latest
      </el-button>
    </header>

    <el-alert
      v-if="actionError"
      type="error"
      :closable="false"
      show-icon
      class="banner err"
    >
      {{ actionError }}
    </el-alert>
    <el-alert
      v-if="streaming.error"
      type="error"
      :closable="false"
      show-icon
      class="banner err"
    >
      {{ streaming.error }}
    </el-alert>

    <div ref="scroller" class="messages">
      <!-- persisted transcript -->
      <article
        v-for="msg in messages"
        :key="msg.id"
        class="msg"
        :class="msg.role"
      >
        <div class="msg-meta">
          <span class="msg-role">{{ msg.role }}</span>
          <span v-if="msgModel(msg)" class="msg-model">{{ msgModel(msg) }}</span>
          <el-button
            text
            size="small"
            class="fork-here"
            :icon="IconFork"
            @click="forkHere(msg)"
          >
            fork here
          </el-button>
        </div>
        <template v-for="(block, i) in renderStoredMessage(msg)" :key="`${msg.id}-${i}`">
          <p v-if="block.kind === 'text'" class="text">{{ block.text }}</p>

          <details
            v-else-if="block.kind === 'thinking'"
            class="thinking"
            :open="!isCollapsed(msg.id)"
            @toggle="toggleThinking(msg.id)"
          >
            <summary>thinking{{ block.redacted ? " (redacted)" : "" }}</summary>
            <pre>{{ block.text }}</pre>
          </details>

          <img
            v-else-if="block.kind === 'image'"
            class="image"
            :src="`data:${block.mimeType};base64,${block.data}`"
            alt="message image"
          />

          <div v-else-if="block.kind === 'toolCall'" class="tool-call">
            <div class="tool-head">
              <span class="tool-name">{{ block.toolName }}</span>
              <el-tag size="small" effect="plain" type="info" class="tool-id">
                {{ block.toolCallId.slice(0, 8) }}
              </el-tag>
            </div>
            <pre class="tool-args">{{ jsonArgs(block.args) }}</pre>
          </div>

          <div v-else-if="block.kind === 'toolResult'" class="tool-result" :class="{ error: block.isError }">
            <div class="tool-head">
              <span class="tool-name">{{ block.toolName }}</span>
              <el-tag size="small" :type="block.isError ? 'danger' : 'success'">
                {{ block.isError ? "error" : "ok" }}
              </el-tag>
            </div>
            <pre v-if="block.text" class="tool-text">{{ block.text }}</pre>
          </div>
        </template>
        <p v-if="messageError(msg)" class="msg-error">{{ messageError(msg) }}</p>
      </article>

      <!-- optimistic pending send -->
      <article v-if="streaming.pendingSend" class="msg user">
        <div class="msg-meta"><span class="msg-role">user</span></div>
        <p class="text">{{ streaming.pendingSend }}</p>
      </article>

      <!-- completed streamed segments (frozen at tool boundaries) -->
      <article
        v-for="(part, i) in streaming.parts"
        :key="`part-${i}`"
        class="msg assistant streaming"
      >
        <div class="msg-meta"><span class="msg-role">assistant</span></div>
        <p v-if="part.text" class="text">{{ part.text }}</p>
        <details v-if="part.thinking" class="thinking" open>
          <summary>thinking…</summary>
          <pre>{{ part.thinking }}</pre>
        </details>
      </article>

      <!-- live streaming placeholder -->
      <article v-if="streamText || streamThinking || streaming.activeTool" class="msg assistant streaming">
        <div class="msg-meta">
          <span class="msg-role">assistant</span>
          <span class="streaming-dot" aria-label="streaming" />
        </div>
        <p v-if="streamText" class="text">{{ streamText }}</p>
        <details v-if="streamThinking" class="thinking" open>
          <summary>thinking…</summary>
          <pre>{{ streamThinking }}</pre>
        </details>
        <div v-if="streaming.activeTool" class="tool-call">
          <div class="tool-head">
            <span class="tool-name">{{ streaming.activeTool.toolName }}</span>
            <el-tag size="small" effect="plain" type="warning" class="tool-id">
              running…
            </el-tag>
          </div>
          <pre v-if="streaming.activeTool.args" class="tool-args">
{{ jsonArgs(streaming.activeTool.args) }}</pre>
        </div>
      </article>

      <div
        v-if="messages.length === 0 && !streaming.pendingSend && !streamText && !streamThinking && !streaming.activeTool && streaming.parts.length === 0"
        class="empty-hint"
      >
        <el-empty description="Send a message to start the session." :image-size="80" />
      </div>
    </div>

    <footer class="chat-foot">
      <div class="usage">
        <template v-if="usage">last run: {{ fmtUsage(usage) }}</template>
        <template v-else>—</template>
      </div>
      <div class="input-row">
        <el-input
          v-model="input"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          resize="none"
          placeholder="Message… (Enter to send, Shift+Enter for newline)"
          @keydown.enter.exact.prevent="send"
        />
        <div class="input-actions">
          <el-button
            :disabled="!input.trim() || running"
            :icon="IconSteering"
            @click="steer"
          >
            Steer
          </el-button>
          <el-button
            :disabled="!input.trim() || running"
            :icon="IconArrowRight"
            @click="followUp"
          >
            Follow-up
          </el-button>
          <el-button v-if="running" type="danger" :icon="IconStop" @click="abort">
            Abort
          </el-button>
          <el-button
            type="primary"
            :disabled="!input.trim() || running"
            :icon="IconTelegram"
            @click="send"
          >
            Send
          </el-button>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.chat-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.chat-title h2 {
  margin: 0;
  font-size: 16px;
}
.chat-model {
  color: var(--fg-dim);
  font-size: 12px;
}
.banner {
  margin: 8px 14px 0;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  max-width: 820px;
  align-self: flex-start;
  min-width: 0;
}
.msg.user {
  align-self: flex-end;
}
.msg.user .text {
  background: var(--bg-user);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
  white-space: pre-wrap;
}
.msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.msg-role {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--fg-dim);
  font-weight: 600;
}
.msg-model {
  font-size: 11px;
  color: var(--fg-dim);
}
.fork-here {
  padding: 0;
  height: auto;
  font-size: 11px;
}
.text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.thinking {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  margin: 4px 0;
}
.thinking summary {
  cursor: pointer;
  color: var(--fg-dim);
  font-size: 12px;
}
.thinking pre {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-dim);
  font-size: 12px;
  margin: 4px 0 0;
}
.image {
  max-width: 320px;
  border-radius: 8px;
  border: 1px solid var(--border);
}
.tool-call,
.tool-result {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  margin: 4px 0;
  background: var(--bg-panel);
  font-size: 12px;
}
.tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-name {
  font-weight: 600;
}
.tool-id {
  font-size: 11px;
}
.tool-args,
.tool-text {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-dim);
  font-size: 12px;
}
.msg-error {
  color: var(--danger);
  font-size: 12px;
  margin: 4px 0 0;
}
.streaming-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
  animation: pulse 1.2s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
.empty-hint {
  color: var(--fg-dim);
  text-align: center;
}
.chat-foot {
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-panel);
}
.usage {
  color: var(--fg-dim);
  font-size: 11px;
}
.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.input-row :deep(.el-textarea) {
  flex: 1;
}
.input-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
