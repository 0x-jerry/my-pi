<script setup lang="ts">
import { computed } from "vue"
import type { SessionInfo, ThinkingLevel, UsageSummary } from "@my-pi/shared"
import { fmtUsage } from "../../utils/format"
import { useModelOptions } from "../../hooks/picks/useModelOptions"
import { useSessionStore } from "../../stores"
import {
  THINKING_DEFAULT,
  THINKING_LEVELS,
} from "../../hooks/settings/useDefaultSettings"
import { showError } from "../../hooks/shared/useErrors"
import IconStop from "~icons/hugeicons/stop"

const props = defineProps<{
  input: string
  running: boolean
  usage?: UsageSummary | undefined
  session?: SessionInfo | undefined
}>()
const emit = defineEmits<{
  (e: "update:input", v: string): void
  (e: "submit"): void
  (e: "abort"): void
}>()

const sessions = useSessionStore()
const { options, loading, toValue, parseValue, refresh } = useModelOptions()

const currentModel = computed(() =>
  toValue(
    props.session?.modelProvider && props.session?.modelId
      ? { provider: props.session.modelProvider, id: props.session.modelId }
      : null,
  ) ?? "",
)

// el-select can't hold undefined/null as a selectable value — the "default"
// choice is the THINKING_DEFAULT sentinel, mapped to null at the API edge
// (NULL row = no per-session override; the agent/settings default applies).
const currentThinking = computed(() => {
  const level = props.session?.thinkingLevel
  return level && (THINKING_LEVELS as readonly string[]).includes(level)
    ? level
    : THINKING_DEFAULT
})

function isThinkingLevel(v: string): v is ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v)
}

async function onChangeModel(value: string): Promise<void> {
  const model = parseValue(value)
  if (!model || !props.session) return
  try {
    await sessions.updateModel(props.session.id, model)
  } catch (err) {
    showError(err)
  }
}

async function onChangeThinking(value: string): Promise<void> {
  if (!props.session) return
  const level = value === THINKING_DEFAULT ? null : isThinkingLevel(value) ? value : null
  try {
    await sessions.updateThinkingLevel(props.session.id, level)
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <footer class="composer-box">
    <el-input
      :model-value="input"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 6 }"
      resize="none"
      placeholder="Message… (Enter to send, Shift+Enter for newline)"
      @update:model-value="$emit('update:input', $event)"
      @keydown.enter.exact.prevent="$emit('submit')"
    />
    <div class="settings-row">
      <el-select
        :model-value="currentModel"
        placeholder="Select model"
        class="model-select"
        filterable
        :loading="loading"
        @change="onChangeModel"
        @visible-change="(v: boolean) => { if (v) refresh() }"
      >
        <el-option
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        />
      </el-select>

      <el-select
        :model-value="currentThinking"
        class="level-select"
        filterable
        @change="onChangeThinking"
      >
        <el-option label="— default —" :value="THINKING_DEFAULT" />
        <el-option v-for="l in THINKING_LEVELS" :key="l" :label="l" :value="l" />
      </el-select>

      <span class="usage">
        <template v-if="usage">last run: {{ fmtUsage(usage) }}</template>
        <template v-else>—</template>
      </span>

      <el-button
        v-if="running"
        class="abort-btn"
        text
        circle
        :icon="IconStop"
        aria-label="Abort"
        title="Abort"
        @click="$emit('abort')"
      />
    </div>
  </footer>
</template>

<style scoped>
.composer-box {
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-panel);
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.model-select {
  width: 220px;
  max-width: 100%;
}
.level-select {
  width: 150px;
  max-width: 100%;
}
.usage {
  color: var(--fg-dim);
  font-size: 11px;
  margin-left: auto;
}
</style>
