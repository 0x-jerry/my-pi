import { ref } from "vue"
import { useWorkspaceStore } from "../../stores"
import { showError } from "../shared/useErrors"
import { folderName } from "../../utils/folderName"

/**
 * The "Add workspace" flow: open the shell's native folder picker, then create
 * the workspace for the chosen directory (name defaults to the folder name).
 */
export function useAddWorkspace() {
  const workspaces = useWorkspaceStore()
  const adding = ref(false)

  async function add(): Promise<void> {
    if (adding.value) return
    adding.value = true
    try {
      const dir = await workspaces.pickFolder()
      if (!dir) return // dialog dismissed
      await workspaces.createWorkspace(folderName(dir), dir)
    } catch (err) {
      showError(err)
    } finally {
      adding.value = false
    }
  }

  return { adding, add }
}
