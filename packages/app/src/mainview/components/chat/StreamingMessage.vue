<script setup lang="ts">
import type { StreamingState } from "../../store"
import { jsonArgs } from "../../utils/format"
import MarkdownContent from "./MarkdownContent.vue"
import ThinkingBlock from "./ThinkingBlock.vue"

defineProps<{
  streaming: StreamingState
  streamText: string
  streamThinking: string
}>()
</script>

<template>
  <!-- optimistic pending send -->
  <article v-if="streaming.pendingSend" class="msg user">
    <div class="msg-meta"><span class="msg-role">user</span></div>
    <MarkdownContent :content="streaming.pendingSend" />
  </article>

  <!-- completed streamed segments (frozen at tool boundaries) -->
  <article
    v-for="(part, i) in streaming.parts"
    :key="`part-${i}`"
    class="msg assistant streaming"
  >
    <div class="msg-meta"><span class="msg-role">assistant</span></div>
    <MarkdownContent v-if="part.text" :content="part.text" />
    <ThinkingBlock v-if="part.thinking" :content="part.thinking" />
  </article>

  <!-- live streaming placeholder -->
  <article
    v-if="streamText || streamThinking || streaming.activeTool"
    class="msg assistant streaming"
  >
    <div class="msg-meta">
      <span class="msg-role">assistant</span>
      <span class="streaming-dot" aria-label="streaming" />
    </div>
    <MarkdownContent :content="streamText" streaming />
    <ThinkingBlock v-if="streamThinking" :content="streamThinking" streaming />
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
</template>

<style scoped>
.msg {
  max-width: 820px;
  align-self: flex-start;
  min-width: 0;
}
.msg.user {
  align-self: flex-end;
}
.msg.user :deep(.comark-content) {
  background: var(--bg-user);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 8px 12px;
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
.tool-call {
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
.tool-args {
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-dim);
  font-size: 12px;
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
</style>
