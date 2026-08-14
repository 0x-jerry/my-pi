<script setup lang="ts">
import { ref } from "vue"
import type { ThinkingLevel } from "@my-pi/shared"
import ModelPicker from "../components/ModelPicker.vue"
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

const model = ref<{ provider: string; id: string } | null>(
  (store.state.settings.defaultModel as { provider: string; id: string } | undefined) ?? null,
)
const thinkingLevel = ref<ThinkingLevel | undefined>(
  (store.state.settings.defaultThinkingLevel as ThinkingLevel | undefined) ?? undefined,
)
const saving = ref(false)
const error = ref<string | null>(null)

async function saveModel() {
  if (!model.value) return
  saving.value = true
  error.value = null
  try {
    await store.setDefaultModel(model.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function saveThinking() {
  if (!thinkingLevel.value) return
  saving.value = true
  error.value = null
  try {
    await store.setDefaultThinkingLevel(thinkingLevel.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="panel">
    <h2>Settings</h2>
    <p class="note">Defaults used when creating new sessions.</p>

    <div v-if="error" class="banner err">{{ error }}</div>

    <div class="setting">
      <h3>Default model</h3>
      <ModelPicker v-model="model" />
      <button
        class="btn primary"
        :disabled="!model || saving"
        @click="saveModel"
      >
        Save default model
      </button>
    </div>

    <div class="setting">
      <h3>Default thinking level</h3>
      <select v-model="thinkingLevel">
        <option :value="undefined">— default —</option>
        <option v-for="l in THINKING_LEVELS" :key="l" :value="l">{{ l }}</option>
      </select>
      <button
        class="btn primary"
        :disabled="!thinkingLevel || saving"
        @click="saveThinking"
      >
        Save thinking level
      </button>
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
.banner.err {
  background: var(--bg-danger);
  color: var(--danger);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.setting {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.setting h3 {
  margin: 0;
  font-size: 14px;
}
.setting select {
  align-self: flex-start;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg);
}
.setting .btn {
  align-self: flex-start;
}
</style>
