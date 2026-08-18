<script setup lang="ts">
import {
  useDefaultSettings,
  THINKING_LEVELS,
  THINKING_DEFAULT,
} from "../../hooks/settings/useDefaultSettings"
import IconCheck from "~icons/hugeicons/checkmark-circle-01"

const {
  options,
  loading,
  toValue,
  parseValue,
  chatModel,
  titleModel,
  backgroundModel,
  thinking,
  saving,
  saveChat,
  saveTitle,
  saveBackground,
  saveThinking,
} = useDefaultSettings()

function onChat(v: string): void {
  chatModel.value = parseValue(v)
}
function onTitle(v: string): void {
  titleModel.value = parseValue(v)
}
function onBackground(v: string): void {
  backgroundModel.value = parseValue(v)
}
</script>

<template>
  <section class="setting">
    <h3>Defaults</h3>
    <p class="note">Defaults used when creating new sessions and background tasks.</p>

    <div class="setting-item">
      <span class="setting-label">Chat model</span>
      <el-select
        :model-value="toValue(chatModel) ?? ''"
        placeholder="Choose chat model"
        class="model-select"
        filterable
        :loading="loading"
        @change="onChat"
      >
        <el-option
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        />
      </el-select>
      <el-button
        type="primary"
        :disabled="!chatModel || saving"
        :icon="IconCheck"
        @click="saveChat"
      >
        Save
      </el-button>
    </div>

    <div class="setting-item">
      <span class="setting-label">Title model</span>
      <el-select
        :model-value="toValue(titleModel) ?? ''"
        placeholder="Inherit background model"
        class="model-select"
        filterable
        :loading="loading"
        @change="onTitle"
      >
        <el-option label="— inherit background model —" value="" />
        <el-option
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        />
      </el-select>
      <el-button type="primary" :disabled="saving" :icon="IconCheck" @click="saveTitle">
        Save
      </el-button>
    </div>

    <div class="setting-item">
      <span class="setting-label">Background model</span>
      <el-select
        :model-value="toValue(backgroundModel) ?? ''"
        placeholder="Choose background model"
        class="model-select"
        filterable
        :loading="loading"
        @change="onBackground"
      >
        <el-option
          v-for="o in options"
          :key="o.value"
          :value="o.value"
          :label="o.label"
        />
      </el-select>
      <el-button
        type="primary"
        :disabled="!backgroundModel || saving"
        :icon="IconCheck"
        @click="saveBackground"
      >
        Save
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
.model-select {
  width: 300px;
  max-width: 100%;
}
.level-select {
  width: 200px;
}
</style>
