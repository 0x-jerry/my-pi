import { computed, ref } from "vue"
import type { ModelInfo, ProviderInfo } from "@my-pi/shared"
import { useModelStore } from "../../stores"
import { useAuth } from "../settings/useAuth"

export type SelectedModel = { provider: string; id: string } | null

/**
 * Behavior for the "Choose model" dialog: browse providers, load their models,
 * authenticate with an API key, and confirm/clear a selection. The parent owns
 * the bound `modelValue` via `getModel()` / `onModel()` callbacks; all dialog
 * UI state (visibility, selections, api key, loading, error) lives here.
 */
export function useModelPicker(
  getModel: () => SelectedModel,
  onModel: (v: SelectedModel) => void,
) {
  const modelsStore = useModelStore()

  const visible = ref(false)
  const selectedProvider = ref<string | null>(null)
  const selectedModel = ref<ModelInfo | null>(null)
  const models = ref<ModelInfo[]>([])
  const apiKey = ref("")
  const loading = ref(false)
  const error = ref<string | null>(null)

  const providers = computed<ProviderInfo[]>(() => modelsStore.state.providers)

  const auth = useAuth()

  function open(): void {
    error.value = null
    selectedProvider.value = getModel()?.provider ?? null
    selectedModel.value = null
    models.value = []
    apiKey.value = "" // never carry a key across dialog opens / provider switches
    visible.value = true
    if (selectedProvider.value) void loadModels(selectedProvider.value)
  }

  async function selectProvider(providerId: string): Promise<void> {
    selectedProvider.value = providerId
    selectedModel.value = null
    apiKey.value = "" // a key is scoped to one provider; don't save it against another
    await loadModels(providerId)
  }

  async function loadModels(providerId: string): Promise<void> {
    loading.value = true
    error.value = null
    const modelValue = getModel()
    try {
      models.value = await modelsStore.listModels(providerId)
      // Re-select the model currently configured for this provider, if any.
      if (modelValue && modelValue.provider === providerId) {
        const match = models.value.find((m) => m.id === modelValue.id)
        if (match) selectedModel.value = match
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      models.value = []
    } finally {
      loading.value = false
    }
  }

  function onModelChange(value: string): void {
    const model = models.value.find((m) => m.id === value)
    selectedModel.value = model ?? null
  }

  function confirm(): void {
    if (!selectedProvider.value || !selectedModel.value) return
    onModel({
      provider: selectedModel.value.providerId,
      id: selectedModel.value.id,
    })
    visible.value = false
  }

  function clear(): void {
    onModel(null)
    visible.value = false
  }

  async function login(): Promise<void> {
    const pid = selectedProvider.value
    if (!pid) return
    error.value = null
    if (await auth.login(pid, apiKey.value)) {
      apiKey.value = ""
      await loadModels(pid)
    } else {
      error.value = auth.error.value[pid] ?? null
    }
  }

  async function logout(providerId: string): Promise<void> {
    error.value = null
    if (await auth.logout(providerId)) {
      if (selectedProvider.value === providerId) {
        models.value = []
        selectedModel.value = null
      }
    } else {
      error.value = auth.error.value[providerId] ?? null
    }
  }

  function providerStatus(p: ProviderInfo): string {
    return p.authConfigured ? "auth ✓" : "no key"
  }

  return {
    visible,
    selectedProvider,
    selectedModel,
    models,
    apiKey,
    loading,
    error,
    providers,
    open,
    selectProvider,
    onModelChange,
    confirm,
    clear,
    login,
    logout,
    providerStatus,
  }
}
