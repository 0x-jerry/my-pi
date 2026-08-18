<script setup lang="ts">
import type { SessionInfo } from "@my-pi/shared"
import IconFork from "~icons/hugeicons/fork"

defineProps<{ session?: SessionInfo | undefined; hasMessages: boolean }>()
defineEmits<{ (e: "fork"): void }>()
</script>

<template>
  <header class="chat-head">
    <div class="chat-title">
      <h2>{{ session?.title ?? "Session" }}</h2>
      <span class="chat-model">{{ session?.modelId ?? "no model" }}</span>
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
}
.chat-model {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
