<script setup lang="ts">
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import IconAiChat from "~icons/hugeicons/ai-chat-01"
import IconPuzzle from "~icons/hugeicons/puzzle"
import IconSettings from "~icons/hugeicons/settings-01"
import WorkspaceTree from "./views/WorkspaceTree.vue"
import { useStore } from "./store"

const store = useStore()
const route = useRoute()
const router = useRouter()

const connectionLabel = computed(() => {
  switch (store.state.connectionState) {
    case "connected":
      return ""
    case "reconnecting":
      return "Reconnecting…"
    case "connecting":
      return "Connecting…"
    default:
      return "Offline"
  }
})

function onTabChange(path: unknown) {
  if (typeof path === "string") void router.push(path)
}
</script>

<template>
  <div class="app">
    <el-alert
      v-if="store.state.error"
      type="error"
      :closable="false"
      class="banner err"
    >
      {{ store.state.error }}
    </el-alert>

    <WorkspaceTree />

    <div v-if="store.state.activeWorkspaceId" class="main">
      <header class="main-head">
          <el-radio-group :model-value="route.path" class="tabs" @change="onTabChange">
            <el-radio-button value="/chat">
              <el-icon><IconAiChat /></el-icon>
              <span>Chat</span>
            </el-radio-button>
            <el-radio-button value="/plugins">
              <el-icon><IconPuzzle /></el-icon>
              <span>Plugins</span>
            </el-radio-button>
            <el-radio-button value="/settings">
              <el-icon><IconSettings /></el-icon>
              <span>Settings</span>
            </el-radio-button>
          </el-radio-group>
          <span v-if="connectionLabel" class="conn" :class="store.state.connectionState">
            <span class="conn-dot" :class="store.state.connectionState" />
            {{ connectionLabel }}
          </span>
        </header>

        <router-view />
    </div>

    <div v-else class="no-workspace">
      <el-empty description="Open or create a workspace to begin." :image-size="96" />
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
  background: var(--bg-panel);
}
.tabs {
  display: flex;
}
.tabs :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.conn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-dim);
}
.conn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-dim);
}
.conn-dot.connecting,
.conn-dot.reconnecting {
  background: var(--warn);
}
.conn.connecting,
.conn.reconnecting {
  color: var(--warn);
}
.no-workspace {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
