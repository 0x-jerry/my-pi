<script setup lang="ts">
import { useWorkspaceStore } from "../stores"
import { useAddWorkspace } from "../hooks/workspace/useAddWorkspace"
import IconRobot from "~icons/hugeicons/robot-01"
import IconFolderAdd from "~icons/hugeicons/folder-add"
import WorkspaceNode from "./WorkspaceNode.vue"

const workspaces = useWorkspaceStore()
const { adding, add } = useAddWorkspace()
</script>

<template>
  <aside class="sidebar">
    <h1 class="brand">
      <el-icon class="brand-icon"><IconRobot /></el-icon>
      <span>my-pi</span>
    </h1>

    <el-button
      type="primary"
      class="add-btn"
      :loading="adding"
      :icon="IconFolderAdd"
      @click="add"
    >
      {{ adding ? "Adding…" : "Add workspace" }}
    </el-button>

    <ul class="tree">
      <WorkspaceNode v-for="ws in workspaces.state.workspaces" :key="ws.id" :ws="ws" />

      <li v-if="workspaces.state.workspaces.length === 0" class="empty">
        <el-empty description="No workspaces yet — add a directory above." :image-size="72" />
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
  background: var(--bg-panel);
}
.brand {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.brand-icon {
  color: var(--accent);
  font-size: 20px;
}
.add-btn {
  width: 100%;
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
  list-style: none;
  padding: 4px 8px;
}
</style>
