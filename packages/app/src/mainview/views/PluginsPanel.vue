<script setup lang="ts">
import { computed, ref } from "vue"
import type { PluginInfo } from "@my-pi/shared"
import { useStore } from "../store"

const store = useStore()

const path = ref("")
const scope = ref<"global" | "workspace">("global")
const adding = ref(false)
const error = ref<string | null>(null)

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
  error.value = null
  if (!path.value.trim()) {
    error.value = "Plugin path is required"
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
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    adding.value = false
  }
}

async function toggle(p: PluginInfo) {
  error.value = null
  try {
    await store.setPluginEnabled(p.id, !p.enabled)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(p: PluginInfo) {
  const ok = window.confirm(`Remove plugin "${p.name}"?`)
  if (!ok) return
  error.value = null
  try {
    await store.removePlugin(p.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
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

    <div v-if="error" class="banner err">{{ error }}</div>

    <form class="add" @submit.prevent="add">
      <input v-model="path" placeholder="/absolute/path/to/plugin" />
      <select v-model="scope">
        <option value="global">global</option>
        <option value="workspace">workspace</option>
      </select>
      <button class="btn primary" type="submit" :disabled="adding">
        {{ adding ? "Adding…" : "Add by path" }}
      </button>
    </form>

    <div class="plugin-groups">
      <div class="group">
        <h3>Global</h3>
        <ul class="plist">
          <li v-for="p in globalPlugins" :key="p.id">
            <span class="pname">{{ p.name }}</span>
            <span class="psrc">{{ p.source }}</span>
            <span class="pdesc">{{ p.description }}</span>
            <button class="btn ghost small" @click="toggle(p)">
              {{ p.enabled ? "Disable" : "Enable" }}
            </button>
            <button class="btn ghost small danger" @click="remove(p)">Remove</button>
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
            <button class="btn ghost small" @click="toggle(p)">
              {{ p.enabled ? "Disable" : "Enable" }}
            </button>
            <button class="btn ghost small danger" @click="remove(p)">Remove</button>
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
}
.banner.err {
  background: var(--bg-danger);
  color: var(--danger);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.add {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.add input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12px;
}
.add select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg);
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
.plist li button {
  grid-row: 1;
}
.plist li button:nth-of-type(1) {
  grid-column: 2;
}
.plist li button:nth-of-type(2) {
  grid-column: 3;
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
