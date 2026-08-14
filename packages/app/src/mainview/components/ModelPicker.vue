<script setup lang="ts">
import { ref } from "vue"
import type { ModelInfo, ProviderInfo } from "@my-pi/shared"
import { useStore } from "../store"

const props = defineProps<{
  modelValue: { provider: string; id: string } | null
}>()
const emit = defineEmits<{
  (e: "update:modelValue", v: { provider: string; id: string } | null): void
}>()

const store = useStore()

const selectedProvider = ref<string | null>(props.modelValue?.provider ?? null)
const models = ref<ModelInfo[]>([])
const apiKey = ref("")
const loading = ref(false)
const error = ref<string | null>(null)

async function selectProvider(providerId: string) {
  selectedProvider.value = providerId
  emit("update:modelValue", null)
  await loadModels(providerId)
}

function onProviderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value) void selectProvider(value)
}

async function loadModels(providerId: string) {
  loading.value = true
  error.value = null
  try {
    models.value = await store.listModels(providerId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    models.value = []
  } finally {
    loading.value = false
  }
}

function choose(model: ModelInfo) {
  emit("update:modelValue", { provider: model.providerId, id: model.id })
}

function onModelChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (!value) {
    clearSelection()
    return
  }
  const model = models.value.find((m) => m.id === value)
  if (model) choose(model)
}

function clearSelection() {
  emit("update:modelValue", null)
}

async function login() {
  if (!selectedProvider.value || !apiKey.value) return
  error.value = null
  try {
    await store.loginApiKey(selectedProvider.value, apiKey.value)
    apiKey.value = ""
    await loadModels(selectedProvider.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function logout(providerId: string) {
  error.value = null
  try {
    await store.logout(providerId)
    if (selectedProvider.value === providerId) models.value = []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function providerStatus(p: ProviderInfo): string {
  return p.authConfigured ? "auth ✓" : "no key"
}
</script>

<template>
  <div class="model-picker">
    <div class="mp-row">
      <label>Provider</label>
      <select
        :value="selectedProvider ?? ''"
        @change="onProviderChange"
      >
        <option value="">— select provider —</option>
        <option v-for="p in store.state.providers" :key="p.id" :value="p.id">
          {{ p.name }} ({{ providerStatus(p) }})
        </option>
      </select>
      <span v-if="error" class="mp-error">{{ error }}</span>
    </div>

    <div v-if="selectedProvider" class="mp-row">
      <label>Model</label>
      <select
        :value="modelValue?.id ?? ''"
        @change="onModelChange"
      >
        <option value="">— choose model —</option>
        <option
          v-for="m in models"
          :key="m.id"
          :value="m.id"
          :disabled="!m.id"
        >
          {{ m.name }} · {{ m.reasoning ? "reasoning" : "fast" }} ·
          {{ (m.contextWindow / 1000).toFixed(0) }}k
        </option>
      </select>
      <span v-if="loading" class="mp-muted">loading…</span>
    </div>

    <div v-if="selectedProvider" class="mp-row mp-apikey">
      <label>API key</label>
      <input
        v-model="apiKey"
        type="password"
        placeholder="sk-…"
        @keyup.enter="login"
      />
      <button class="btn" :disabled="!apiKey" @click="login">Save key</button>
      <button class="btn ghost" @click="logout(selectedProvider)">Logout</button>
    </div>

    <p v-if="modelValue" class="mp-selected">
      Selected: {{ modelValue.provider }} / {{ modelValue.id }}
    </p>
  </div>
</template>

<style scoped>
.model-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-row label {
  min-width: 72px;
  color: var(--fg-dim);
}
select,
input {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg);
  font-size: 13px;
  max-width: 320px;
}
.mp-error {
  color: var(--danger);
}
.mp-muted {
  color: var(--fg-dim);
}
.mp-selected {
  margin: 0;
  color: var(--fg-dim);
}
</style>
