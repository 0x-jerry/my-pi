import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router"
import ChatPage from "./views/ChatPage.vue"
import PluginsPanel from "./views/PluginsPanel.vue"
import SettingsPanel from "./views/SettingsPanel.vue"

export const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/chat" },
  { path: "/chat", name: "chat", component: ChatPage, meta: { title: "Chat" } },
  { path: "/plugins", name: "plugins", component: PluginsPanel, meta: { title: "Plugins" } },
  { path: "/settings", name: "settings", component: SettingsPanel, meta: { title: "Settings" } },
]

/**
 * In-memory history: the packaged `views://` scheme resolves files by exact
 * path and rejects both query strings and hash fragments, so URL-based
 * histories (web / hash) would break the shipped build. The shell is a
 * single-window desktop app — no deep links or reloads — so keeping
 * navigation state in memory is safe and works identically in dev and prod.
 */
export const router = createRouter({
  history: createMemoryHistory(),
  routes,
})
