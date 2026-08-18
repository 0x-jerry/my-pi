<script setup lang="ts">
import { DEFAULT_SESSION_TITLE } from "@my-pi/shared"
import { useSessionStore } from "../stores"
import IconDelete from "~icons/hugeicons/delete-01"

const props = defineProps<{ localId: string }>()
const sessions = useSessionStore()
</script>

<template>
  <li class="session-row draft">
    <button
      class="session"
      :class="{ active: sessions.state.activeSessionId === localId }"
      @click="sessions.openDraft(localId)"
    >
      <span class="dot dot-draft" />
      <span class="title">{{ DEFAULT_SESSION_TITLE }}</span>
    </button>
    <el-tooltip content="Discard draft" placement="top">
      <el-button
        class="icon-btn danger"
        text
        circle
        :icon="IconDelete"
        aria-label="Discard draft"
        @click="sessions.discardDraft(localId)"
      />
    </el-tooltip>
  </li>
</template>

<style scoped>
.session-row {
  display: flex;
  align-items: center;
  gap: 2px;
  /* Fixed height = default el-button height, so revealing the action
     buttons on hover never changes the row's height. */
  height: 32px;
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
  height: 100%;
  padding: 0 8px;
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
/* Draft placeholder: dashed ring, italic title. */
.session-row.draft .dot {
  background: transparent;
  border: 1.5px dashed var(--fg-dim);
}
.session-row.draft .title {
  font-style: italic;
  color: var(--fg-dim);
}
.session-row.draft {
  padding-right: 4px;
}
.icon-btn {
  color: var(--fg-dim);
}
.icon-btn.danger:hover {
  color: var(--danger);
}
</style>
