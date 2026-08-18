<script setup lang="ts">
import { computed } from "vue"
import type { Workspace } from "@my-pi/shared"
import { useWorkspaceStore, useSessionStore } from "../stores"
import { useWorkspaceNode } from "../hooks/workspace/useWorkspaceNode"
import IconFolder from "~icons/hugeicons/folder-01"
import IconFolderOpen from "~icons/hugeicons/folder-open"
import IconArrowRight from "~icons/hugeicons/arrow-right-01"
import IconArrowDown from "~icons/hugeicons/arrow-down-01"
import IconPlus from "~icons/hugeicons/plus-sign"
import IconDelete from "~icons/hugeicons/delete-01"
import SessionItem from "./SessionItem.vue"
import DraftItem from "./DraftItem.vue"

const props = defineProps<{ ws: Workspace }>()
const workspaces = useWorkspaceStore()
const sessions = useSessionStore()
const { open, remove, newSession } = useWorkspaceNode()

const isActive = computed(() => workspaces.state.activeWorkspaceId === props.ws.id)
/** Local placeholder nodes of this workspace's expanded (active) subtree. */
const drafts = computed(() =>
  workspaces.state.drafts.filter((d) => d.workspaceId === props.ws.id),
)
</script>

<template>
  <li class="ws-node">
    <div class="ws-row" :class="{ active: isActive }" @click="open(ws)">
      <el-icon class="chevron">
        <IconArrowDown v-if="isActive" />
        <IconArrowRight v-else />
      </el-icon>
      <el-icon class="ws-icon">
        <IconFolderOpen v-if="isActive" />
        <IconFolder v-else />
      </el-icon>
      <span class="ws-name">{{ ws.name }}</span>
      <span class="ws-actions">
        <el-tooltip content="New session" placement="top">
          <el-button
            class="icon-btn"
            text
            circle
            :icon="IconPlus"
            aria-label="New session"
            @click.stop="newSession(ws)"
          />
        </el-tooltip>
        <el-tooltip content="Remove workspace" placement="top">
          <el-button
            class="icon-btn danger"
            text
            circle
            :icon="IconDelete"
            aria-label="Remove workspace"
            @click.stop="remove(ws)"
          />
        </el-tooltip>
      </span>
    </div>

    <ul v-if="isActive" class="children">
      <DraftItem v-for="d in drafts" :key="d.localId" :local-id="d.localId" />
      <SessionItem v-for="s in sessions.state.sessions" :key="s.id" :session="s" />
      <li v-if="sessions.state.sessions.length === 0 && drafts.length === 0" class="empty">
        No sessions yet — click + to start one.
      </li>
    </ul>
  </li>
</template>

<style scoped>
.ws-node {
  /* structural — children list nests inside */
}
.ws-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--fg);
}
.ws-row:hover {
  background: var(--bg-hover);
}
.ws-row.active {
  border-color: var(--accent);
  background: var(--bg-active);
}
.chevron {
  flex-shrink: 0;
  color: var(--fg-dim);
  font-size: 12px;
}
.ws-icon {
  flex-shrink: 0;
  color: var(--warn);
  font-size: 16px;
}
.ws-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 13px;
}
.ws-actions {
  display: none;
  gap: 2px;
  align-items: center;
}
.ws-row:hover .ws-actions,
.ws-row.active .ws-actions {
  display: inline-flex;
}
.children {
  list-style: none;
  margin: 2px 0 4px;
  padding: 0 0 0 26px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.icon-btn {
  color: var(--fg-dim);
}
.icon-btn.danger:hover {
  color: var(--danger);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
  list-style: none;
  padding: 4px 8px;
}
</style>
