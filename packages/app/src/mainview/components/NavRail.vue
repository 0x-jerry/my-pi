<script setup lang="ts">
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import IconFolder from "~icons/hugeicons/folder-01"
import IconSettings from "~icons/hugeicons/settings-01"
import { useStore } from "../store"

const store = useStore()
const route = useRoute()
const router = useRouter()

/** Logo "Pi" color mirrors the connection state (see store connectionState). */
const logoClass = computed(() => {
  switch (store.state.connectionState) {
    case "connected":
      return "logo-ok"
    case "connecting":
    case "reconnecting":
      return "logo-warn"
    default:
      return "logo-offline"
  }
})

function isActive(name: string): boolean {
  return route.name === name
}

function go(path: string) {
  void router.push(path)
}
</script>

<template>
  <nav class="rail">
    <button class="logo" :class="logoClass" title="Pi" @click="go('/')">Pi</button>

    <div class="rail-items">
      <button
        class="rail-btn"
        :class="{ active: isActive('home') }"
        title="Workspace"
        @click="go('/')"
      >
        <el-icon class="rail-icon"><IconFolder /></el-icon>
        <span class="rail-label">Workspace</span>
      </button>
    </div>

    <div class="rail-spacer" />

    <button
      class="rail-btn"
      :class="{ active: isActive('settings') }"
      title="Settings"
      @click="go('/settings')"
    >
      <el-icon class="rail-icon"><IconSettings /></el-icon>
      <span class="rail-label">Settings</span>
    </button>
  </nav>
</template>

<style scoped>
.rail {
  width: 96px;
  flex-shrink: 0;
  height: 100%;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  user-select: none;
}
.logo {
  border: none;
  background: transparent;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  padding: 4px 8px;
  font-family: inherit;
  transition: color 0.2s ease;
}
.logo-ok {
  color: var(--ok);
}
.logo-warn {
  color: var(--warn);
}
.logo-offline {
  color: var(--fg-dim);
}
.rail-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.rail-spacer {
  flex: 1;
}
.rail-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}
.rail-btn:hover {
  background: var(--bg-hover);
}
.rail-btn.active {
  border-color: var(--accent);
  background: var(--bg-active);
  color: var(--accent);
}
.rail-btn.active .rail-label {
  color: var(--accent);
}
.rail-icon {
  font-size: 20px;
}
</style>
