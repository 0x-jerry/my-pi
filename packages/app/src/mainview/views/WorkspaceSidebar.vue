<script setup lang="ts">
import { ref } from "vue"
import type { Workspace } from "@my-pi/shared"
import { useStore } from "../store"

const store = useStore()

const name = ref("")
const path = ref("")
const creating = ref(false)
const error = ref<string | null>(null)

async function create() {
  error.value = null
  if (!path.value.trim()) {
    error.value = "Directory path is required"
    return
  }
  creating.value = true
  try {
    await store.createWorkspace(name.value, path.value)
    name.value = ""
    path.value = ""
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

async function open(ws: Workspace) {
  error.value = null
  try {
    await store.openWorkspace(ws.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(ws: Workspace) {
  const ok = window.confirm(`Remove workspace "${ws.name}"?\nAll sessions and messages will be deleted.`)
  if (!ok) return
  error.value = null
  try {
    await store.removeWorkspace(ws.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <aside class="sidebar">
    <h1 class="brand">my-pi</h1>

    <form class="create" @submit.prevent="create">
      <input v-model="name" placeholder="Name (optional)" />
      <input v-model="path" placeholder="/path/to/workspace" />
      <button class="btn primary" type="submit" :disabled="creating">
        {{ creating ? "Adding…" : "Add workspace" }}
      </button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>

    <ul class="ws-list">
      <li v-for="ws in store.state.workspaces" :key="ws.id">
        <button
          class="ws"
          :class="{ active: store.state.activeWorkspaceId === ws.id }"
          @click="open(ws)"
        >
          <span class="ws-name">{{ ws.name }}</span>
          <span class="ws-path">{{ ws.path }}</span>
        </button>
        <button class="icon-btn" title="Remove workspace" @click="remove(ws)">
          ✕
        </button>
      </li>
      <li v-if="store.state.workspaces.length === 0" class="empty">
        No workspaces yet — add a directory above.
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px;
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
}
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.create input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg);
  font-size: 12px;
}
.err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
  word-break: break-word;
}
.ws-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ws-list li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ws {
  flex: 1;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}
.ws:hover {
  background: var(--bg-hover);
}
.ws.active {
  border-color: var(--accent);
  background: var(--bg-active);
}
.ws-name {
  font-weight: 600;
  font-size: 13px;
}
.ws-path {
  color: var(--fg-dim);
  font-size: 11px;
  word-break: break-all;
}
.icon-btn {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
}
.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--danger);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
