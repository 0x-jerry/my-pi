import { RpcMethod, type ThinkingLevel } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Settings domain: load and persist the model + thinking-level defaults: the
 * chat model (used by all sessions by default), the background-task model
 * used by background jobs (legacy `defaultModel` key), the optional title
 * model (falls back to the background model), and the default thinking level.
 */
export class SettingsStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
  }

  async load(): Promise<void> {
    const defaultModel = await this.getModelSetting("defaultModel")
    if (defaultModel) this.state.settings.defaultModel = defaultModel
    const chatModel = await this.getModelSetting("chatModel")
    if (chatModel) this.state.settings.chatModel = chatModel
    const titleModel = await this.getModelSetting("titleModel")
    if (titleModel) this.state.settings.titleModel = titleModel
    const thinking = await this.client.call<ThinkingLevel | undefined>(
      RpcMethod.settingsGet,
      { key: "defaultThinkingLevel" },
    )
    if (thinking) this.state.settings.defaultThinkingLevel = thinking
  }

  private async getModelSetting(key: string) {
    return this.client.call<{ provider: string; id: string } | undefined>(
      RpcMethod.settingsGet,
      { key },
    )
  }

  private async setModelSetting(
    key: string,
    model: { provider: string; id: string } | null,
  ): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, { key, value: model })
    if (model) {
      this.state.settings[key] = model
    } else {
      delete this.state.settings[key]
    }
  }

  async setDefaultModel(model: { provider: string; id: string }): Promise<void> {
    return this.setModelSetting("defaultModel", model)
  }

  async setChatModel(model: { provider: string; id: string } | null): Promise<void> {
    return this.setModelSetting("chatModel", model)
  }

  async setTitleModel(model: { provider: string; id: string } | null): Promise<void> {
    return this.setModelSetting("titleModel", model)
  }

  async setDefaultThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultThinkingLevel",
      value: level,
    })
    this.state.settings.defaultThinkingLevel = level
  }
}
