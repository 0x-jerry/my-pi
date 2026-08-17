<script setup lang="ts">
import { ref } from "vue"
import { ElMessage } from "element-plus"
import type { ThinkingLevel } from "@my-pi/shared"
import ModelPicker from "../components/ModelPicker.vue"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"
import { useStore } from "../store"

const store = useStore()

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

// el-select can't hold undefined as a selectable option value — the "default"
// choice is a sentinel string mapped to undefined at the API edge.
const THINKING_DEFAULT = "__default__"

const model = ref<{ provider: string; id: string } | null>(
  (store.state.settings.defaultModel as { provider: string; id: string } | undefined) ?? null,
)
const thinking = ref<string>(
  (store.state.settings.defaultThinkingLevel as ThinkingLevel | undefined) ??
    THINKING_DEFAULT,
)
const saving = ref(false)

async function saveModel() {
  if (!model.value) return
  saving.value = true
  try {
    await store.setDefaultModel(model.value)
    ElMessage.success("Default model saved")
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}

async function saveThinking() {
  if (thinking.value === THINKING_DEFAULT) return
  saving.value = true
  try {
    await store.setDefaultThinkingLevel(thinking.value as ThinkingLevel)
    ElMessage.success("Thinking level saved")
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h2>Settings</h2>
    <p class="note">Defaults used when creating new sessions.</p>

    <div class="setting">
      <h3>Default model</h3>
      <ModelPicker v-model="model" />
      <div class="setting-actions">
        <el-button type="primary" :disabled="!model || saving" :icon="IconCheck" @click="saveModel">
          Save default model
        </el-button>
      </div>
    </div>

    <div class="setting">
      <h3>Default thinking level</h3>
      <el-select v-model="thinking" class="level-select" filterable>
        <el-option label="— default —" :value="THINKING_DEFAULT" />
        <el-option v-for="l in THINKING_LEVELS" :key="l" :label="l" :value="l" />
      </el-select>
      <div class="setting-actions">
        <el-button
          type="primary"
          :disabled="thinking === THINKING_DEFAULT || saving"
          :icon="IconCheck"
          @click="saveThinking"
        >
          Save thinking level
        </el-button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 640px;
}
.panel h2 {
  margin: 0;
  font-size: 17px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
.setting {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--bg-panel);
}
.setting h3 {
  margin: 0;
  font-size: 14px;
}
.level-select {
  align-self: flex-start;
  width: 200px;
}
</style>
