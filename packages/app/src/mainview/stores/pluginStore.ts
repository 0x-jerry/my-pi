import { RpcMethod, type PluginInfo } from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"

/**
 * Plugins domain: global and workspace-scoped plugin lists plus add/remove/
 * enable operations. After any mutation both lists are refreshed so the
 * settings UI stays consistent.
 */
export class PluginStore {
  private readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient, _connection: ConnectionStore) {
    this.state = state
    this.client = client
  }

  async loadGlobal(): Promise<void> {
    this.state.pluginsGlobal = await this.client.call<PluginInfo[]>(
      RpcMethod.pluginsList,
      {},
    )
  }

  async loadForWorkspace(workspaceId: string): Promise<void> {
    this.state.pluginsWorkspace[workspaceId] = await this.client.call<PluginInfo[]>(
      RpcMethod.pluginsList,
      { workspaceId },
    )
  }

  private async refresh(): Promise<void> {
    await this.loadGlobal()
    const wsId = this.state.activeWorkspaceId
    if (wsId) await this.loadForWorkspace(wsId)
  }

  async add(input: {
    source: string
    scope?: "global" | "workspace"
    workspaceId?: string
    name?: string
  }): Promise<void> {
    await this.client.call(RpcMethod.pluginsAdd, input)
    await this.refresh()
  }

  async remove(id: string): Promise<void> {
    await this.client.call(RpcMethod.pluginsRemove, { id })
    await this.refresh()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.client.call(RpcMethod.pluginsSetEnabled, { id, enabled })
    await this.refresh()
  }
}
