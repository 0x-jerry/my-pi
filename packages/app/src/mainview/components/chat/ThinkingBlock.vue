<script setup lang="ts">
import { computed, ref, useId } from "vue"
import MarkdownContent from "./MarkdownContent.vue"

const props = defineProps<{
  content: string
  /** True while the thinking is still streaming in (label + incremental render). */
  streaming?: boolean
  /** True when the provider redacted the thinking content. */
  redacted?: boolean
}>()

// Default is collapsed. We never auto-open or auto-collapse, so a manually
// expanded block stays expanded ("respect the user's manual state") and a
// finished block is collapsed by default ("collapsed when thinking is done").
const expanded = ref(false)

function toggle(): void {
  expanded.value = !expanded.value
}

// Collapsed preview: the last three non-empty trailing lines of the raw text,
// so readers see what the model most recently reasoned about. Rendered as
// plain text (never Markdown) because partial markdown in the tail (e.g. an
// unclosed code fence) would swallow the whole preview.
const tail = computed(() => {
  const lines = props.content.split("\n")
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === "") end--
  const start = Math.max(0, end - 3)
  return { text: lines.slice(start, end).join("\n"), truncated: start > 0 }
})

const label = computed(() =>
  props.redacted ? "thinking (redacted)" : props.streaming ? "thinking…" : "thinking",
)

const bodyId = useId()
</script>

<template>
  <div class="thinking" :class="{ streaming }">
    <button
      type="button"
      class="thinking-toggle"
      :aria-expanded="expanded"
      :aria-controls="expanded ? bodyId : undefined"
      @click="toggle"
    >
      <span class="thinking-chevron">{{ expanded ? "▾" : "▸" }}</span>
      <span class="thinking-label">{{ label }}</span>
      <span class="thinking-hint">{{ expanded ? "hide" : "show more" }}</span>
    </button>

    <div v-if="expanded" :id="bodyId" class="thinking-body">
      <MarkdownContent :content="content" :streaming="streaming" />
    </div>

    <div v-else class="thinking-preview">
      <span v-if="tail.truncated" class="thinking-ellipsis">…</span>
      <pre class="thinking-preview-text">{{ tail.text }}</pre>
    </div>
  </div>
</template>

<style scoped>
.thinking {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  margin: 4px 0;
}
.thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--fg-dim);
  font-size: 12px;
  font-family: inherit;
}
.thinking-chevron {
  font-size: 10px;
}
.thinking-hint {
  opacity: 0.6;
}
.thinking-preview {
  margin-top: 4px;
  max-height: calc(3 * 1.5em);
  overflow: hidden;
}
.thinking-ellipsis {
  display: block;
  color: var(--fg-dim);
  font-size: 12px;
  line-height: 1.5;
}
.thinking-preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg-dim);
  font-size: 12px;
  line-height: 1.5;
}
.thinking-body {
  margin-top: 4px;
}
</style>
