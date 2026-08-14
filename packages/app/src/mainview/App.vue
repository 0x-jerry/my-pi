<script setup lang="ts">
import { computed, ref } from "vue"
import WorkspaceSidebar from "./views/WorkspaceSidebar.vue"
import SessionList from "./views/SessionList.vue"
import ChatView from "./views/ChatView.vue"
import PluginsPanel from "./views/PluginsPanel.vue"
import SettingsPanel from "./views/SettingsPanel.vue"
import { useStore } from "./store"

const store = useStore()

const panel = ref<"chat" | "plugins" | "settings">("chat")

const activeSessionId = computed(() => store.state.activeSessionId)
const connectionLabel = computed(() => {
  switch (store.state.connectionState) {
    case "connected":
      return ""
    case "reconnecting":
      return "reconnecting…"
    case "connecting":
      return "connecting…"
    default:
      return "offline"
  }
})
</script>

<template>
  <div class="app">
    <div v-if="store.state.error" class="banner err">{{ store.state.error }}</div>

    <WorkspaceSidebar />

    <div v-if="store.state.activeWorkspaceId" class="mid">
      <SessionList />
      <main class="main">
        <header class="main-head">
          <nav class="tabs">
            <button :class="{ active: panel === 'chat' }" @click="panel = 'chat'">
              Chat
            </button>
            <button :class="{ active: panel === 'plugins' }" @click="panel = 'plugins'">
              Plugins
            </button>
            <button :class="{ active: panel === 'settings' }" @click="panel = 'settings'">
              Settings
            </button>
          </nav>
          <span v-if="connectionLabel" class="conn" :class="store.state.connectionState">
            {{ connectionLabel }}
          </span>
        </header>

        <ChatView
          v-if="panel === 'chat' && activeSessionId"
          :key="activeSessionId"
          :session-id="activeSessionId"
        />
        <div v-else-if="panel === 'chat'" class="empty-state">
          <p>Select or create a session to start chatting.</p>
        </div>
        <PluginsPanel v-if="panel === 'plugins'" />
        <SettingsPanel v-if="panel === 'settings'" />
      </main>
    </div>

    <div v-else class="no-workspace">
      <p>Open or create a workspace to begin.</p>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100vh;
  position: relative;
}
.banner.err {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: var(--bg-danger);
  color: var(--danger);
  padding: 8px 14px;
  font-size: 13px;
}
.mid {
  flex: 1;
  display: flex;
  min-width: 0;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.main-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}
.tabs {
  display: flex;
  gap: 4px;
}
.tabs button {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.tabs button:hover {
  background: var(--bg-hover);
}
.tabs button.active {
  background: var(--bg-active);
  color: var(--fg);
  font-weight: 600;
}
.conn {
  font-size: 12px;
  color: var(--fg-dim);
}
.conn.reconnecting,
.conn.connecting {
  color: var(--warn);
}
.empty-state,
.no-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
}
</style>
