<script setup lang="ts">
import type { PluginInfo } from "@my-pi/shared"
import { usePlugins } from "../../hooks/settings/usePlugins"
import IconPlus from "~icons/hugeicons/plus-sign"
import IconDelete from "~icons/hugeicons/delete-01"

const { path, scope, adding, activeWorkspaceId, globalPlugins, workspacePlugins, add, toggle, remove } =
  usePlugins()

function onToggleSwitch(p: PluginInfo, value: unknown): void {
  void toggle(p, Boolean(value))
}
</script>

<template>
  <section class="setting">
    <h3>Plugins</h3>
    <p class="note">
      Enabling/disabling applies to sessions loaded <strong>after</strong> the
      toggle — restart the session (send a message again) to pick up changes.
    </p>

    <form class="plugin-add" @submit.prevent="add">
      <el-input v-model="path" placeholder="/absolute/path/to/plugin" clearable />
      <el-select v-model="scope" class="scope-select">
        <el-option label="global" value="global" />
        <el-option label="workspace" value="workspace" />
      </el-select>
      <el-button type="primary" native-type="submit" :loading="adding">
        <el-icon v-if="!adding"><IconPlus /></el-icon>
        <span>{{ adding ? "Adding…" : "Add by path" }}</span>
      </el-button>
    </form>

    <div class="plugin-groups">
      <div class="group">
        <h4>Global</h4>
        <ul class="plist">
          <li v-for="p in globalPlugins" :key="p.id">
            <span class="pname">{{ p.name }}</span>
            <span class="psrc">{{ p.source }}</span>
            <span class="pdesc">{{ p.description }}</span>
            <el-switch
              :model-value="p.enabled"
              inline-prompt
              active-text="on"
              inactive-text="off"
              class="pswitch"
              @change="onToggleSwitch(p, $event)"
            />
            <el-tooltip content="Remove plugin" placement="top">
              <el-button
                text
                circle
                class="pdel"
                :icon="IconDelete"
                @click="remove(p)"
              />
            </el-tooltip>
          </li>
          <li v-if="globalPlugins.length === 0" class="empty">—</li>
        </ul>
      </div>

      <div v-if="activeWorkspaceId" class="group">
        <h4>Workspace ({{ activeWorkspaceId.slice(0, 8) }})</h4>
        <ul class="plist">
          <li v-for="p in workspacePlugins" :key="p.id">
            <span class="pname">{{ p.name }}</span>
            <span class="psrc">{{ p.source }}</span>
            <span class="pdesc">{{ p.description }}</span>
            <el-switch
              :model-value="p.enabled"
              inline-prompt
              active-text="on"
              inactive-text="off"
              class="pswitch"
              @change="onToggleSwitch(p, $event)"
            />
            <el-tooltip content="Remove plugin" placement="top">
              <el-button
                text
                circle
                class="pdel"
                :icon="IconDelete"
                @click="remove(p)"
              />
            </el-tooltip>
          </li>
          <li v-if="workspacePlugins.length === 0" class="empty">—</li>
        </ul>
      </div>
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
.plugin-add {
  display: flex;
  gap: 8px;
  align-items: center;
}
.plugin-add :deep(.el-input) {
  flex: 1;
}
.scope-select {
  width: 140px;
}
.plugin-groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.group h4 {
  font-size: 13px;
  color: var(--fg-dim);
  margin: 0 0 6px;
}
.plist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.plist li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 4px 10px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}
.pname {
  font-weight: 600;
  font-size: 13px;
}
.psrc {
  grid-column: 1;
  color: var(--fg-dim);
  font-size: 11px;
  word-break: break-all;
}
.pdesc {
  grid-column: 1;
  color: var(--fg-dim);
  font-size: 12px;
}
.pswitch {
  grid-column: 2;
  grid-row: 1;
}
.pdel {
  grid-column: 3;
  grid-row: 1;
  color: var(--fg-dim);
}
.pdel:hover {
  color: var(--danger);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
