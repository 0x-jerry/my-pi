<script setup lang="ts">
import { ref } from "vue"
import type { SessionInfo, ThinkingLevel } from "@my-pi/shared"
import ModelPicker from "../components/ModelPicker.vue"
import { fmtSessionTokens } from "../utils/format"
import { useStore } from "../store"

const store = useStore()

const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]

const showCreate = ref(false)
const title = ref("")
const model = ref<{ provider: string; id: string } | null>(null)
const thinkingLevel = ref<ThinkingLevel | undefined>(undefined)
const creating = ref(false)
const error = ref<string | null>(null)

function openCreate() {
  error.value = null
  showCreate.value = true
  // Prefill from defaults so a bare "create" produces a usable session.
  const def = store.state.settings.defaultModel
  if (def && !model.value) model.value = def as { provider: string; id: string }
  const tl = store.state.settings.defaultThinkingLevel
  if (tl) thinkingLevel.value = tl as ThinkingLevel
}

async function create() {
  const wsId = store.state.activeWorkspaceId
  if (!wsId) return
  error.value = null
  creating.value = true
  try {
    const session = await store.createSession({
      workspaceId: wsId,
      title: title.value.trim() || undefined,
      model: model.value ?? undefined,
      thinkingLevel: thinkingLevel.value,
    })
    showCreate.value = false
    title.value = ""
    model.value = null
    thinkingLevel.value = undefined
    await store.openSession(session.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

async function open(s: SessionInfo) {
  error.value = null
  try {
    await store.openSession(s.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function fork(s: SessionInfo) {
  error.value = null
  try {
    const forked = await store.forkSession(s.id)
    await store.openSession(forked.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function remove(s: SessionInfo) {
  const ok = window.confirm(`Delete session "${s.title}"?`)
  if (!ok) return
  error.value = null
  try {
    await store.deleteSession(s.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function statusDot(s: SessionInfo): string {
  return s.status === "running"
    ? "🟢"
    : s.status === "error"
      ? "🔴"
      : s.status === "stopped"
        ? "⏹"
        : "⚪"
}
</script>

<template>
  <aside class="session-pane">
    <header class="pane-head">
      <h2>Sessions</h2>
      <button class="btn" @click="showCreate ? (showCreate = false) : openCreate()">
        {{ showCreate ? "Cancel" : "+ New" }}
      </button>
    </header>

    <form v-if="showCreate" class="create" @submit.prevent="create">
      <input v-model="title" placeholder="Title (optional)" />
      <select v-model="thinkingLevel">
        <option :value="undefined">Thinking: default</option>
        <option v-for="l in THINKING_LEVELS" :key="l" :value="l">
          Thinking: {{ l }}
        </option>
      </select>
      <ModelPicker v-model="model" />
      <button class="btn primary" type="submit" :disabled="creating">
        {{ creating ? "Creating…" : "Create session" }}
      </button>
      <p v-if="error" class="err">{{ error }}</p>
    </form>

    <ul class="session-list">
      <li v-for="s in store.state.sessions" :key="s.id">
        <button
          class="session"
          :class="{ active: store.state.activeSessionId === s.id }"
          @click="open(s)"
        >
          <span class="row1">
            <span class="dot">{{ statusDot(s) }}</span>
            <span class="title">{{ s.title }}</span>
          </span>
          <span class="row2">
            <span>{{ s.modelId ?? "no model" }}</span>
            <span>{{ fmtSessionTokens(s) }}</span>
          </span>
          <span class="row3">
            <span>{{ s.messageCount }} msgs</span>
            <span v-if="s.forkedFromSessionId">fork</span>
          </span>
        </button>
        <div class="actions">
          <button class="icon-btn" title="Fork session" @click="fork(s)">⑂</button>
          <button class="icon-btn" title="Delete session" @click="remove(s)">✕</button>
        </div>
      </li>
      <li v-if="store.state.sessions.length === 0" class="empty">
        No sessions yet.
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.session-pane {
  width: 280px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
  background: var(--bg-panel);
}
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pane-head h2 {
  margin: 0;
  font-size: 15px;
}
.create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.create input,
.create select {
  padding: 5px 8px;
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
}
.session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.session-list li {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
}
.session {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.session.active .row1 {
  color: var(--accent);
}
.row1 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
}
.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row2,
.row3 {
  display: flex;
  justify-content: space-between;
  color: var(--fg-dim);
  font-size: 11px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
}
.icon-btn {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
}
.icon-btn:hover {
  background: var(--bg-hover);
}
.empty {
  color: var(--fg-dim);
  font-size: 12px;
  list-style: none;
}
</style>
