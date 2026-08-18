import { computed, ref, watch } from "vue"
import type { ProviderInfo } from "@my-pi/shared"
import { useModelStore } from "../../stores"

/**
 * A single flattened `provider/model` option for el-select, built from models
 * of authenticated providers only.
 */
export interface ModelOption {
  /** Flat unique value: `${providerId}/${modelId}`. */
  value: string
  /** Human label: `${providerName} / ${modelName}`. */
  label: string
  providerId: string
  modelId: string
}

export type ModelRef = { provider: string; id: string } | null

/**
 * Flattened model selector options (the chat-header select and the Defaults
 * panel selects all share this). Only providers with `authConfigured === true`
 * are listed; each one's model catalog is loaded up-front. The options follow
 * auth changes automatically (adding/logging out of a provider refreshes the
 * flat list), and overlapping refreshes are de-duplicated so a stale result
 * can never overwrite a newer one.
 */
export function useModelOptions() {
  const modelStore = useModelStore()

  const loading = ref(false)
  const options = ref<ModelOption[]>([])

  const authedProviders = computed<ProviderInfo[]>(() =>
    modelStore.state.providers.filter((p) => p.authConfigured),
  )

  // Invocation token: only the most-recent refresh may write options/loading,
  // so a slow stale call can't clobber a newer result.
  let seq = 0

  async function refresh(): Promise<void> {
    const token = ++seq
    loading.value = true
    try {
      const providerList = authedProviders.value
      const all: ModelOption[] = []
      await Promise.all(
        providerList.map(async (p) => {
          try {
            const models = await modelStore.listModels(p.id)
            for (const m of models) {
              if (!m.id) continue
              all.push({
                value: `${m.providerId}/${m.id}`,
                label: `${m.providerName} / ${m.name}`,
                providerId: m.providerId,
                modelId: m.id,
              })
            }
          } catch {
            // A provider whose catalog fails loads nothing; keep the rest.
          }
        }),
      )
      if (token === seq) options.value = all
    } finally {
      if (token === seq) loading.value = false
    }
  }

  // Load once on mount and re-sync whenever the set of authenticated providers
  // changes (e.g. authenticating/logging out of a provider elsewhere).
  watch(authedProviders, () => void refresh(), { immediate: true })

  /** Map a stored model ref to its flat value string, or null if absent. */
  function toValue(model: ModelRef | undefined | null): string | null {
    if (!model) return null
    const opt = options.value.find(
      (o) => o.providerId === model.provider && o.modelId === model.id,
    )
    if (opt) return opt.value
    // The stored model isn't in the current (authed) catalog — still render
    // the raw provider/model so the current selection stays visible.
    return `${model.provider}/${model.id}`
  }

  /** Parse a flat `${provider}/${model}` value back into a model ref. */
  function parseValue(value: string | undefined): ModelRef {
    if (!value) return null
    const i = value.indexOf("/")
    if (i <= 0 || i === value.length - 1) return null
    return { provider: value.slice(0, i), id: value.slice(i + 1) }
  }

  return { loading, options, authedProviders, refresh, toValue, parseValue }
}
