import { reactive } from "vue"
import { RpcMethod, type PluginInfo } from "@my-pi/shared"
import type { SessionStore } from "./sessionStore"
import type { RpcClient } from "../rpc/client"

/** Plugins slice: global and workspace-scoped plugin lists. Owned by PluginStore. */
function createPluginState() {
  return reactive({
    pluginsGlobal: [] as PluginInfo[],
    pluginsWorkspace: {} as Record<string, PluginInfo[]>,
  })
}
export type PluginStateSlice = ReturnType<typeof createPluginState>

/**
 * Plugins domain: global and workspace-scoped plugin lists plus add/remove/
 * enable operations. After any mutation both lists are refreshed so the
 * settings UI stays consistent.
 */
export class PluginStore {
  private readonly client: RpcClient
  private readonly sessions: SessionStore
  readonly state: PluginStateSlice

  constructor(client: RpcClient, sessions: SessionStore) {
    this.state = createPluginState()
    this.client = client
    this.sessions = sessions
  }

  async loadGlobal(): Promise<void> {
    this.state.pluginsGlobal = await this.client.call(RpcMethod.pluginsList)
  }

  async loadForWorkspace(workspaceId: string): Promise<void> {
    this.state.pluginsWorkspace[workspaceId] = await this.client.call(
      RpcMethod.pluginsList,
      { workspaceId },
    )
  }

  private async refresh(): Promise<void> {
    await this.loadGlobal()
    const wsId = this.sessions.state.activeWorkspaceId
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
