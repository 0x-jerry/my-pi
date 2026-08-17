<script setup lang="ts">
import { computed, ref } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import type { PluginInfo } from "@my-pi/shared"
import IconPlus from "~icons/hugeicons/plus-sign"
import IconDelete from "~icons/hugeicons/delete-01"
import { useStore } from "../store"

const store = useStore()

const path = ref("")
const scope = ref<"global" | "workspace">("global")
const adding = ref(false)

// Always mirror store state (which refreshes on connect/reconnect and after
// every mutation) instead of keeping private copies that can go stale.
const globalPlugins = computed(() =>
  store.state.pluginsGlobal.filter((p) => p.scope === "global"),
)
const workspacePlugins = computed(() => {
  const wsId = store.state.activeWorkspaceId
  return wsId
    ? (store.state.pluginsWorkspace[wsId] ?? []).filter((p) => p.scope === "workspace")
    : []
})

async function add() {
  if (!path.value.trim()) {
    ElMessage.warning("Plugin path is required")
    return
  }
  adding.value = true
  try {
    await store.addPlugin({
      source: path.value.trim(),
      scope: scope.value,
      workspaceId:
        scope.value === "workspace" ? (store.state.activeWorkspaceId ?? undefined) : undefined,
    })
    path.value = ""
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    adding.value = false
  }
}

async function toggle(p: PluginInfo, enabled: boolean) {
  try {
    await store.setPluginEnabled(p.id, enabled)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}

function toggleSwitch(p: PluginInfo, value: unknown) {
  void toggle(p, Boolean(value))
}

async function remove(p: PluginInfo) {
  try {
    await ElMessageBox.confirm(`Remove plugin "${p.name}"?`, "Remove plugin", {
      type: "warning",
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
    })
  } catch {
    return // dismissed
  }
  try {
    await store.removePlugin(p.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  }
}
</script>

<template>
  <section class="panel">
    <h2>Plugins</h2>
    <p class="note">
      Enabling/disabling applies to sessions loaded <strong>after</strong> the
      toggle — restart the session (send a message again) to pick up changes.
    </p>

    <form class="add" @submit.prevent="add">
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
        <h3>Global</h3>
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
              @change="toggleSwitch(p, $event)"
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

      <div v-if="store.state.activeWorkspaceId" class="group">
        <h3>Workspace ({{ store.state.activeWorkspaceId.slice(0, 8) }})</h3>
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
              @change="toggleSwitch(p, $event)"
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
.panel {
  padding: 16px;
  overflow-y: auto;
}
.panel h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
.add {
  display: flex;
  gap: 8px;
  margin: 12px 0;
  align-items: center;
}
.add :deep(.el-input) {
  flex: 1;
}
.scope-select {
  width: 140px;
}
.plugin-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.group h3 {
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
