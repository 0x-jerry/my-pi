<script setup lang="ts">
import type { SessionInfo } from "@my-pi/shared"

defineProps<{
  session?: SessionInfo | undefined
}>()
</script>

<template>
  <header class="chat-head">
    <h2>{{ session?.title ?? "Session" }}</h2>
  </header>
</template>

<style scoped>
.chat-head {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.chat-head h2 {
  margin: 0;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40vw;
}
</style>
