import { RpcMethod, type ModelInfo, type ProviderInfo } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Models/auth domain: provider list, available models per provider, and
 * API-key login/logout. Refreshes the provider list after auth changes so the
 * UI's `authConfigured` flags stay in sync.
 */
export class ModelStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
  }

  async loadProviders(): Promise<void> {
    this.state.providers = await this.client.call<ProviderInfo[]>(
      RpcMethod.modelsProviders,
      {},
    )
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    const models = await this.client.call<ModelInfo[]>(
      RpcMethod.modelsAvailable,
      { providerId },
    )
    this.state.models[providerId] = models
    return models
  }

  async loginApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.client.call<void>(RpcMethod.modelsLogin, { providerId, apiKey })
    await this.loadProviders()
  }

  async logout(providerId: string): Promise<void> {
    await this.client.call<void>(RpcMethod.modelsLogout, { providerId })
    await this.loadProviders()
  }
}
