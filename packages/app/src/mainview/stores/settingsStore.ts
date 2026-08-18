import { RpcMethod, type ThinkingLevel } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Settings domain: load and persist the default model + default thinking
 * level used when creating new sessions.
 */
export class SettingsStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
  }

  async load(): Promise<void> {
    const defaultModel = await this.client.call<
      { provider: string; id: string } | undefined
    >(RpcMethod.settingsGet, { key: "defaultModel" })
    if (defaultModel) this.state.settings.defaultModel = defaultModel
    const thinking = await this.client.call<ThinkingLevel | undefined>(
      RpcMethod.settingsGet,
      { key: "defaultThinkingLevel" },
    )
    if (thinking) this.state.settings.defaultThinkingLevel = thinking
  }

  async setDefaultModel(model: { provider: string; id: string }): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultModel",
      value: model,
    })
    this.state.settings.defaultModel = model
  }

  async setDefaultThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.client.call(RpcMethod.settingsSet, {
      key: "defaultThinkingLevel",
      value: level,
    })
    this.state.settings.defaultThinkingLevel = level
  }
}
