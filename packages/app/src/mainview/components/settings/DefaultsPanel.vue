<script setup lang="ts">
import ModelPicker from "../ModelPicker.vue"
import {
  useDefaultSettings,
  THINKING_LEVELS,
  THINKING_DEFAULT,
} from "../../hooks/settings/useDefaultSettings"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"

const { model, thinking, saving, saveModel, saveThinking } = useDefaultSettings()
</script>

<template>
  <section class="setting">
    <h3>Defaults</h3>
    <p class="note">Defaults used when creating new sessions.</p>

    <div class="setting-item">
      <span class="setting-label">Default model</span>
      <ModelPicker v-model="model" />
      <el-button
        type="primary"
        :disabled="!model || saving"
        :icon="IconCheck"
        @click="saveModel"
      >
        Save default model
      </el-button>
    </div>

    <div class="setting-item">
      <span class="setting-label">Default thinking level</span>
      <el-select v-model="thinking" class="level-select" filterable>
        <el-option label="— default —" :value="THINKING_DEFAULT" />
        <el-option v-for="l in THINKING_LEVELS" :key="l" :label="l" :value="l" />
      </el-select>
      <el-button
        type="primary"
        :disabled="thinking === THINKING_DEFAULT || saving"
        :icon="IconCheck"
        @click="saveThinking"
      >
        Save thinking level
      </el-button>
    </div>
  </section>
</template>

<style scoped>
.setting {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  background: var(--bg-panel);
}
.setting h3 {
  margin: 0;
  font-size: 15px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
.setting-item {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.setting-label {
  min-width: 150px;
  color: var(--fg);
  font-size: 13px;
}
.level-select {
  width: 200px;
}
</style>
