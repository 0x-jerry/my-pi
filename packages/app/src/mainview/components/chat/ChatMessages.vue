<script setup lang="ts">
import { ref } from "vue"
import type { StoredMessage } from "@my-pi/shared"
import type { StreamingState } from "../../store"
import { messageError, renderStoredMessage } from "../../utils/render"
import { fmtMsgUsage, jsonArgs } from "../../utils/format"
import { useChatDisplay } from "../../hooks/chat/useChatDisplay"
import { useStreamScroll } from "../../hooks/chat/useStreamScroll"
import IconFork from "~icons/hugeicons/fork"

const props = defineProps<{
  messages: StoredMessage[]
  streaming: StreamingState
  streamText: string
  streamThinking: string
}>()
const emit = defineEmits<{ (e: "forkHere", msg: StoredMessage): void }>()

const scroller = ref<HTMLElement | null>(null)
const { toggleThinking, isCollapsed } = useChatDisplay()
useStreamScroll(
  () => [props.messages.length, props.streamText, props.streamThinking],
  scroller,
)

function msgLabel(msg: StoredMessage): string {
  return [msg.provider, msg.model].filter(Boolean).join(" / ")
}
</script>

<template>
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
      </div>
      <div class="msg-body">
        <template
          v-for="(block, i) in renderStoredMessage(msg)"
          :key="`${msg.id}-${i}`"
        >
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

          <div
            v-else-if="block.kind === 'toolResult'"
            class="tool-result"
            :class="{ error: block.isError }"
          >
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
      </div>
      <div class="msg-foot">
        <span v-if="msgLabel(msg)" class="msg-model">{{ msgLabel(msg) }}</span>
        <span v-if="msg.usage" class="msg-usage">{{ fmtMsgUsage(msg.usage) }}</span>
        <el-tooltip content="Fork here" placement="top">
          <el-button
            text
            circle
            size="small"
            class="fork-here"
            :icon="IconFork"
            aria-label="Fork here"
            @click="emit('forkHere', msg)"
          />
        </el-tooltip>
      </div>
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
</template>

<style scoped>
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
.msg-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.msg.user .msg-foot {
  justify-content: flex-end;
}
.msg-model {
  font-size: 11px;
  color: var(--fg-dim);
}
.msg-usage {
  font-size: 11px;
  color: var(--fg-dim);
}
.fork-here {
  padding: 0;
  height: auto;
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
</style>
