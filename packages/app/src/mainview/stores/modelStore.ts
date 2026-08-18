import { reactive } from "vue"
import { RpcMethod, type ModelInfo, type ProviderInfo } from "@my-pi/shared"
import type { RpcClient } from "../rpc/client"

/** Models/auth slice: provider list and per-provider model catalogs. Owned by ModelStore. */
function createModelState() {
  return reactive({
    providers: [] as ProviderInfo[],
    models: {} as Record<string, ModelInfo[]>,
  })
}
export type ModelStateSlice = ReturnType<typeof createModelState>

/**
 * Models/auth domain: provider list, available models per provider, and
 * API-key login/logout. Refreshes the provider list after auth changes so the
 * UI's `authConfigured` flags stay in sync.
 */
export class ModelStore {
  private readonly client: RpcClient
  readonly state: ModelStateSlice

  constructor(client: RpcClient) {
    this.state = createModelState()
    this.client = client
  }

  async loadProviders(): Promise<void> {
    this.state.providers = await this.client.call(RpcMethod.modelsProviders)
  }

  async listModels(providerId: string): Promise<ModelInfo[]> {
    const models = await this.client.call(RpcMethod.modelsAvailable, {
      providerId,
    })
    this.state.models[providerId] = models
    return models
  }

  async loginApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.client.call(RpcMethod.modelsLogin, { providerId, apiKey })
    await this.loadProviders()
  }

  async logout(providerId: string): Promise<void> {
    await this.client.call(RpcMethod.modelsLogout, { providerId })
    await this.loadProviders()
  }
}
