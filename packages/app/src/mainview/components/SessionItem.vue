<script setup lang="ts">
import type { SessionInfo } from "@my-pi/shared"
import { useSessionStore } from "../stores"
import { useSessionActions } from "../hooks/workspace/useSessionActions"
import { statusDot } from "../utils/statusDot"
import IconFork from "~icons/hugeicons/fork"
import IconDelete from "~icons/hugeicons/delete-01"

const props = defineProps<{ session: SessionInfo }>()
const sessions = useSessionStore()
const { openSession, fork, removeSession } = useSessionActions()
</script>

<template>
  <li class="session-row">
    <button
      class="session"
      :class="{ active: sessions.state.activeSessionId === session.id }"
      @click="openSession(session)"
    >
      <span class="dot" :class="statusDot(session)" />
      <span class="title">{{ session.title }}</span>
    </button>
    <span class="session-actions">
      <el-tooltip content="Fork session" placement="top">
        <el-button class="icon-btn" text circle :icon="IconFork" @click="fork(session)" />
      </el-tooltip>
      <el-tooltip content="Delete session" placement="top">
        <el-button
          class="icon-btn danger"
          text
          circle
          :icon="IconDelete"
          @click="removeSession(session)"
        />
      </el-tooltip>
    </span>
  </li>
</template>

<style scoped>
.session-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 6px;
}
.session-row:hover {
  background: var(--bg-hover);
}
.session {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
}
.session.active {
  background: var(--bg-active);
}
.session.active .title {
  color: var(--accent);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-running {
  background: var(--ok);
}
.dot-error {
  background: var(--danger);
}
.dot-idle {
  background: var(--fg-dim);
}
.session-actions {
  display: none;
  gap: 2px;
  align-items: center;
  padding-right: 4px;
}
.session-row:hover .session-actions {
  display: inline-flex;
}
.icon-btn {
  color: var(--fg-dim);
}
.icon-btn.danger:hover {
  color: var(--danger);
}
</style>
