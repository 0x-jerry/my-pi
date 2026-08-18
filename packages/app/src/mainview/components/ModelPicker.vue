<script setup lang="ts">
import IconModel from "~icons/hugeicons/ai-chat-01"
import IconLogin from "~icons/hugeicons/login-01"
import IconLogout from "~icons/hugeicons/logout-01"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"
import { useModelPicker } from "../hooks/picks/useModelPicker"

const props = defineProps<{
  modelValue: { provider: string; id: string } | null
}>()
const emit = defineEmits<{
  (e: "update:modelValue", v: { provider: string; id: string } | null): void
}>()

const {
  visible,
  selectedProvider,
  selectedModel,
  models,
  apiKey,
  loading,
  error,
  providers,
  open,
  selectProvider,
  onModelChange,
  confirm,
  clear,
  login,
  logout,
  providerStatus,
} = useModelPicker(
  () => props.modelValue,
  (v) => emit("update:modelValue", v),
)
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
            <el-option v-for="p in providers" :key="p.id" :value="p.id">
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
