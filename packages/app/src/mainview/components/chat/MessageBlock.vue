<script setup lang="ts">
import type { RenderedBlock } from "../../utils/render"
import { jsonArgs } from "../../utils/format"
import MarkdownContent from "./MarkdownContent.vue"
import ThinkingBlock from "./ThinkingBlock.vue"

defineProps<{
  block: RenderedBlock
}>()
</script>

<template>
  <MarkdownContent v-if="block.kind === 'text'" :content="block.text" />

  <ThinkingBlock
    v-else-if="block.kind === 'thinking'"
    :content="block.text"
    :redacted="block.redacted"
  />

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

<style scoped>
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
</style>
