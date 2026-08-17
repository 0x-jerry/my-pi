import { createMemoryHistory, createRouter, type RouteRecordRaw } from "vue-router"
import HomePage from "./views/HomePage.vue"
import SettingsPage from "./views/SettingsPage.vue"

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "home", component: HomePage, meta: { title: "Home" } },
  { path: "/settings", name: "settings", component: SettingsPage, meta: { title: "Settings" } },
  // Legacy paths (pre-layout-refactor): keep working for safety.
  { path: "/chat", redirect: "/" },
  { path: "/plugins", redirect: "/settings" },
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
