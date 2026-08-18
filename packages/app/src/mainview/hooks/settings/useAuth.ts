import { ref } from "vue"
import { useModelStore } from "../../stores"

/**
 * Shared provider-auth behavior used by both the ModelPicker dialog and the
 * Settings auth panel: per-provider busy/error state and login/logout RPC
 * calls. Returns whether the call succeeded so callers can react (toasts,
 * model reload), and surfaces failures via `error[providerId]`.
 */
export function useAuth() {
  const models = useModelStore()

  const busy = ref<Record<string, boolean>>({})
  const error = ref<Record<string, string | null>>({})

  async function login(providerId: string, apiKey: string): Promise<boolean> {
    if (!apiKey.trim()) return false
    busy.value[providerId] = true
    error.value[providerId] = null
    try {
      await models.loginApiKey(providerId, apiKey)
      return true
    } catch (err) {
      error.value[providerId] = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busy.value[providerId] = false
    }
  }

  async function logout(providerId: string): Promise<boolean> {
    busy.value[providerId] = true
    error.value[providerId] = null
    try {
      await models.logout(providerId)
      return true
    } catch (err) {
      error.value[providerId] = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busy.value[providerId] = false
    }
  }

  return { busy, error, login, logout }
}
