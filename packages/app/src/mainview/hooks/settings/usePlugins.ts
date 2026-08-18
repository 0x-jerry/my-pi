import { computed, ref } from "vue"
import { ElMessage } from "element-plus"
import type { PluginInfo } from "@my-pi/shared"
import { usePluginStore } from "../../stores"
import { showError } from "../shared/useErrors"
import { confirmAction } from "../shared/useConfirm"

/**
 * Plugins settings: add a plugin by path (global or workspace scope), toggle
 * enabled state, and remove (with confirmation). Reads plugin lists from the
 * plugin store's shared state.
 */
export function usePlugins() {
  const plugins = usePluginStore()

  const path = ref("")
  const scope = ref<"global" | "workspace">("global")
  const adding = ref(false)

  const globalPlugins = computed(() =>
    plugins.state.pluginsGlobal.filter((p) => p.scope === "global"),
  )
  const activeWorkspaceId = computed(() => plugins.state.activeWorkspaceId)
  const workspacePlugins = computed(() => {
    const wsId = plugins.state.activeWorkspaceId
    return wsId
      ? (plugins.state.pluginsWorkspace[wsId] ?? []).filter((p) => p.scope === "workspace")
      : []
  })

  async function add(): Promise<void> {
    if (!path.value.trim()) {
      ElMessage.warning("Plugin path is required")
      return
    }
    adding.value = true
    try {
      await plugins.add({
        source: path.value.trim(),
        scope: scope.value,
        workspaceId:
          scope.value === "workspace"
            ? (plugins.state.activeWorkspaceId ?? undefined)
            : undefined,
      })
      path.value = ""
    } catch (err) {
      showError(err)
    } finally {
      adding.value = false
    }
  }

  async function toggle(p: PluginInfo, enabled: boolean): Promise<void> {
    try {
      await plugins.setEnabled(p.id, enabled)
    } catch (err) {
      showError(err)
    }
  }

  async function remove(p: PluginInfo): Promise<void> {
    const confirmed = await confirmAction({
      title: "Remove plugin",
      message: `Remove plugin "${p.name}"?`,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
    })
    if (!confirmed) return
    try {
      await plugins.remove(p.id)
    } catch (err) {
      showError(err)
    }
  }

  return { path, scope, adding, activeWorkspaceId, globalPlugins, workspacePlugins, add, toggle, remove }
}
