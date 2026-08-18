<script setup lang="ts">
import { computed } from "vue"
import type { SessionInfo } from "@my-pi/shared"
import IconFork from "~icons/hugeicons/fork"
import { useModelOptions } from "../../hooks/picks/useModelOptions"
import { useSessionStore } from "../../stores"
import { showError } from "../../hooks/shared/useErrors"

const props = defineProps<{
  session?: SessionInfo | undefined
  hasMessages: boolean
}>()
const emit = defineEmits<{ (e: "fork"): void }>()

const sessions = useSessionStore()
const { options, loading, toValue, parseValue, refresh } = useModelOptions()

const currentValue = computed(() =>
  toValue(
    props.session?.modelProvider && props.session?.modelId
      ? { provider: props.session.modelProvider, id: props.session.modelId }
      : null,
  ) ?? "",
)

async function onChange(value: string): Promise<void> {
  const model = parseValue(value)
  if (!model || !props.session) return
  try {
    await sessions.updateModel(props.session.id, model)
  } catch (err) {
    showError(err)
  }
}
</script>

<template>
  <header class="chat-head">
    <div class="chat-title">
      <h2>{{ session?.title ?? "Session" }}</h2>
      <el-select
        :model-value="currentValue"
        placeholder="Select model"
        class="chat-model"
        filterable
        :loading="loading"
        @change="onChange"
        @visible-change="(v: boolean) => { if (v) refresh() }"
      >
        <el-option
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        />
      </el-select>
    </div>
    <el-button v-if="hasMessages" text :icon="IconFork" @click="$emit('fork')">
      Fork at latest
    </el-button>
  </header>
</template>

<style scoped>
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}
.chat-model {
  width: 260px;
  max-width: 100%;
}
</style>
