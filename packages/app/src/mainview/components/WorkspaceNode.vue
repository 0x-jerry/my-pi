<script setup lang="ts">
import { computed, ref } from "vue"
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
const { remove, newSession } = useWorkspaceNode()

const isActive = computed(() => workspaces.state.activeWorkspaceId === props.ws.id)
/**
 * This node owns its own expand state (not derived from the active
 * workspace), so several nodes can be expanded at the same time.
 */
const expanded = ref(false)

/** This workspace's sessions from the per-workspace store cache. */
const nodeSessions = computed(() => sessions.sessionsFor(props.ws.id))
/** Local placeholder nodes of this workspace's expanded subtree. */
const drafts = computed(() =>
  workspaces.state.drafts.filter((d) => d.workspaceId === props.ws.id),
)

/** True while this workspace's sessions are being fetched on expand. */
const loading = ref(false)

/** Toggle this node's own expansion; never switches the active workspace. */
function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value) {
    // Ensure this workspace's sessions are in the per-workspace cache (they
    // may not be loaded yet if the node was never expanded before).
    loading.value = true
    void sessions
      .load(props.ws.id)
      .catch((err) => {
        sessions.state.error = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        loading.value = false
      })
  }
}

/** Start a session and expand the node so the draft placeholder is visible. */
async function onNewSession(): Promise<void> {
  expanded.value = true
  await newSession(props.ws)
}
</script>

<template>
  <li class="ws-node">
    <div class="ws-row" :class="{ active: isActive }" @click="toggle">
      <el-icon class="chevron">
        <IconArrowDown v-if="expanded" />
        <IconArrowRight v-else />
      </el-icon>
      <el-icon class="ws-icon">
        <IconFolderOpen v-if="expanded" />
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
            @click.stop="onNewSession"
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

    <ul v-if="expanded" class="children">
      <DraftItem v-for="d in drafts" :key="d.localId" :local-id="d.localId" />
      <SessionItem v-for="s in nodeSessions" :key="s.id" :session="s" />
      <li v-if="!loading && nodeSessions.length === 0 && drafts.length === 0" class="empty">
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
  /* Fixed height = default el-button height, so revealing the action
     buttons (hover/active) never changes the node's height. */
  height: 32px;
  padding: 0 8px;
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
