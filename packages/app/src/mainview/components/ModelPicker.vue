<script setup lang="ts">
import { ref } from "vue"
import type { ModelInfo, ProviderInfo } from "@my-pi/shared"
import IconModel from "~icons/hugeicons/ai-chat-01"
import IconLogin from "~icons/hugeicons/login-01"
import IconLogout from "~icons/hugeicons/logout-01"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"
import { useStore } from "../store"

const props = defineProps<{
  modelValue: { provider: string; id: string } | null
}>()
const emit = defineEmits<{
  (e: "update:modelValue", v: { provider: string; id: string } | null): void
}>()

const store = useStore()

const visible = ref(false)
const selectedProvider = ref<string | null>(null)
const selectedModel = ref<ModelInfo | null>(null)
const models = ref<ModelInfo[]>([])
const apiKey = ref("")
const loading = ref(false)
const error = ref<string | null>(null)

function open() {
  error.value = null
  selectedProvider.value = props.modelValue?.provider ?? null
  selectedModel.value = null
  models.value = []
  apiKey.value = "" // never carry a key across dialog opens / provider switches
  visible.value = true
  if (selectedProvider.value) void loadModels(selectedProvider.value)
}

async function selectProvider(providerId: string) {
  selectedProvider.value = providerId
  selectedModel.value = null
  apiKey.value = "" // a key is scoped to one provider; don't save it against another
  await loadModels(providerId)
}

async function loadModels(providerId: string) {
  loading.value = true
  error.value = null
  try {
    models.value = await store.listModels(providerId)
    // Re-select the model currently configured for this provider, if any.
    const cur = props.modelValue
    if (cur && cur.provider === providerId) {
      const match = models.value.find((m) => m.id === cur.id)
      if (match) selectedModel.value = match
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    models.value = []
  } finally {
    loading.value = false
  }
}

function onModelChange(value: string) {
  const model = models.value.find((m) => m.id === value)
  selectedModel.value = model ?? null
}

function confirm() {
  if (!selectedProvider.value || !selectedModel.value) return
  emit("update:modelValue", {
    provider: selectedModel.value.providerId,
    id: selectedModel.value.id,
  })
  visible.value = false
}

function clear() {
  emit("update:modelValue", null)
  visible.value = false
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
    if (selectedProvider.value === providerId) {
      models.value = []
      selectedModel.value = null
    }
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
    <el-button class="mp-trigger" :icon="IconModel" @click="open">
      <span class="mp-trigger-text">
        {{ modelValue ? `${modelValue.provider} / ${modelValue.id}` : "Choose model…" }}
      </span>
    </el-button>

    <el-dialog
      v-model="visible"
      title="Choose model"
      width="480px"
      :close-on-click-modal="false"
    >
      <div class="mp-body">
        <div class="mp-row">
          <label>Provider</label>
          <el-select
            :model-value="selectedProvider ?? ''"
            placeholder="Select provider"
            class="mp-select"
            filterable
            @change="selectProvider"
          >
            <el-option v-for="p in store.state.providers" :key="p.id" :value="p.id">
              <span class="prov-name">{{ p.name }}</span>
              <el-tag
                size="small"
                effect="plain"
                :type="p.authConfigured ? 'success' : 'info'"
              >
                {{ providerStatus(p) }}
              </el-tag>
            </el-option>
          </el-select>
        </div>

        <div v-if="selectedProvider" class="mp-row">
          <label>Model</label>
          <el-select
            :model-value="selectedModel?.id ?? ''"
            placeholder="Choose model"
            class="mp-select"
            :loading="loading"
            loading-text="Loading…"
            filterable
            @change="onModelChange"
          >
            <el-option
              v-for="m in models"
              :key="m.id"
              :value="m.id"
              :disabled="!m.id"
            >
              {{ m.name }} · {{ m.reasoning ? "reasoning" : "fast" }} ·
              {{ (m.contextWindow / 1000).toFixed(0) }}k
            </el-option>
          </el-select>
        </div>

        <div v-if="selectedProvider" class="mp-row mp-apikey">
          <label>API key</label>
          <el-input
            v-model="apiKey"
            type="password"
            show-password
            placeholder="sk-…"
            class="mp-key-input"
            @keydown.enter="login"
          />
          <el-button :disabled="!apiKey" :icon="IconLogin" @click="login">
            Save key
          </el-button>
          <el-button text :icon="IconLogout" @click="logout(selectedProvider)">
            Logout
          </el-button>
        </div>

        <el-alert
          v-if="error"
          type="error"
          :closable="false"
          show-icon
          class="mp-error"
        >
          {{ error }}
        </el-alert>
      </div>

      <template #footer>
        <div class="mp-footer">
          <el-button text type="danger" :disabled="!modelValue" @click="clear">
            Clear selection
          </el-button>
          <span class="mp-footer-right">
            <el-button @click="visible = false">Cancel</el-button>
            <el-button
              type="primary"
              :disabled="!selectedModel"
              :icon="IconCheck"
              @click="confirm"
            >
              Use model
            </el-button>
          </span>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.model-picker {
  font-size: 13px;
}
.mp-trigger {
  width: 100%;
  justify-content: flex-start;
}
.mp-trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.mp-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.mp-select {
  width: 320px;
  max-width: 100%;
}
.mp-key-input {
  width: 260px;
  max-width: 100%;
}
.mp-error {
  margin: 0;
}
.mp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.mp-footer-right {
  display: flex;
  gap: 8px;
}
</style>
