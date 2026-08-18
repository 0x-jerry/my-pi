import { RpcMethod, SETTING_KEYS, type SettingKey, type ThinkingLevel } from "@my-pi/shared"
import type { AllSettings, SettingValue } from "@my-pi/core"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/** The three model-valued settings; `defaultThinkingLevel` is excluded. */
type ModelSettingKey = Extract<SettingKey, "chatModel" | "defaultModel" | "titleModel">
/** Reactive-state form: a cleared setting is an absent key, never null. */
type ModelValue = Exclude<SettingValue<ModelSettingKey>, null>

/**
 * Settings domain: load and persist the model + thinking-level defaults: the
 * chat model (used by all sessions by default), the background-task model
 * used by background jobs (legacy `defaultModel` key), the optional title
 * model (falls back to the background model), and the default thinking level.
 *
 * Key and value types are derived from the core settings schema map
 * (`SettingKey`/`SettingValue`), so the wire payloads and the reactive
 * `state.settings` slice can't drift from what the core validates. The core
 * server is the single validating authority; the client only maps the
 * snapshot into state, normalizing the wire's stored-but-cleared `null` to
 * an absent key.
 */
export class SettingsStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
  }

  async load(): Promise<void> {
    // `settings.getAll` is a tolerant read: it only emits known keys whose
    // stored values validate against the core schema map, so no per-key
    // client-side validation is needed here.
    const snapshot = (await this.client.call(
      RpcMethod.settingsGetAll,
    )) as Partial<AllSettings>
    // Key list is typed (`SETTING_KEYS`), so this is the single boundary cast:
    // per-key value types were reified by the server's schema validation.
    const state = this.state.settings as Record<string, unknown>
    for (const key of SETTING_KEYS) {
      const raw = snapshot[key]
      if (raw === undefined || raw === null) continue // cleared → absent
      state[key] = raw
    }
  }

  /** Persist a model setting; `null` clears it (stored as null, then dropped from state). */
  private async writeModel(key: ModelSettingKey, model: ModelValue | null): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, { key, value: model })
    if (model) {
      this.state.settings[key] = model
    } else {
      delete this.state.settings[key]
    }
  }

  async setDefaultModel(model: ModelValue): Promise<void> {
    return this.writeModel("defaultModel", model)
  }

  async setChatModel(model: ModelValue | null): Promise<void> {
    return this.writeModel("chatModel", model)
  }

  async setTitleModel(model: ModelValue | null): Promise<void> {
    return this.writeModel("titleModel", model)
  }

  async setDefaultThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultThinkingLevel",
      value: level,
    })
    this.state.settings.defaultThinkingLevel = level
  }
}