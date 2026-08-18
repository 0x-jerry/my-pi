import { inject, reactive, type InjectionKey } from "vue"
import type { RpcClient } from "../rpc/client"
import { ConnectionStore } from "./connectionStore"
import { WorkspaceStore } from "./workspaceStore"
import { SessionStore } from "./sessionStore"
import { ChatStore } from "./chatStore"
import { ModelStore } from "./modelStore"
import { SettingsStore } from "./settingsStore"
import { PluginStore } from "./pluginStore"

export type { ConnectionStateSlice } from "./connectionStore"
export type { WorkspaceStateSlice } from "./workspaceStore"
export type { SessionStateSlice } from "./sessionStore"
export type { ChatStateSlice } from "./chatStore"
export type { ModelStateSlice } from "./modelStore"
export type { SettingsStateSlice } from "./settingsStore"
export type { PluginStateSlice } from "./pluginStore"
export type {
  ActiveToolState,
  DraftSession,
  StreamedPart,
  StreamingState,
} from "./types"

/**
 * Root-owned state slice: the global error banner (boot failures, load
 * errors, notification-handler rejections).
 */
function createRootState() {
  return reactive({
    error: null as string | null,
  })
}
export type AppState = ReturnType<typeof createRootState>

/**
 * Root store: the composition root. Each domain store owns its own reactive
 * state slice (declared in its own file) and its own operations — consumers
 * call the focused store directly via `useXStore()`; this class does NOT wrap
 * sub-store methods. It owns the global error banner and the few workflows
 * that genuinely span stores (refreshAll, openWorkspace, removeWorkspace,
 * sendDraft), plus the cross-store hook wiring (no cycles).
 */
export class Store {
  readonly client: RpcClient
  /** Root-owned state: the global error banner. */
  readonly state: AppState
  readonly connection: ConnectionStore
  readonly workspaces: WorkspaceStore
  readonly sessions: SessionStore
  readonly chat: ChatStore
  readonly models: ModelStore
  readonly settings: SettingsStore
  readonly plugins: PluginStore

  constructor(client: RpcClient) {
    this.client = client
    this.state = createRootState()
    this.connection = new ConnectionStore(client)
    this.workspaces = new WorkspaceStore(client, this.connection)
    this.sessions = new SessionStore(client, this.workspaces)
    this.chat = new ChatStore(client, this.connection, this.sessions)
    this.models = new ModelStore(client)
    this.settings = new SettingsStore(client)
    this.plugins = new PluginStore(client, this.sessions)

    // Cross-store hooks (post-construction so nothing forms a cycle).
    this.connection.setError = (message) => this.setError(message)
    this.sessions.setError = (message) => this.setError(message)
    // Deleted sessions / removed workspaces drop their chat state.
    this.sessions.onSessionEvicted = (id) => this.chat.evictSession(id)
    this.workspaces.onWorkspaceRemoved = (id) => {
      this.sessions.clearWorkspace(id)
      this.workspaces.clearDraftsOfWorkspace(id)
    }
    client.onRefreshAll = () => void this.refreshAll()

    // Opening a session makes its workspace active; lazy-load that
    // workspace's plugins, matching openWorkspace's behavior. (Drafts do not
    // switch the active workspace — only real session selection does.)
    this.sessions.onWorkspaceActivated = (workspaceId: string): void => {
      void this.plugins.loadForWorkspace(workspaceId).catch((err) => {
        this.setError(err instanceof Error ? err.message : String(err))
      })
    }
  }

  /** Surface an error into the global banner (boot failures, load errors). */
  setError(message: string): void {
    this.state.error = message
  }

  // ---- cross-domain workflows ----

  /**
   * Re-sync everything on (re)connect, including the active workspace's
   * sessions and the active session's transcript: runs that finished while
   * disconnected push no notifications to the new connection.
   */
  async refreshAll(): Promise<void> {
    // Refresh every workspace whose sessions are cached (expanded nodes), plus
    // the active workspace even if it was never expanded yet.
    const workspaceIds = new Set(
      Object.keys(this.sessions.state.sessionsByWorkspace),
    )
    if (this.sessions.state.activeWorkspaceId) {
      workspaceIds.add(this.sessions.state.activeWorkspaceId)
    }
    await Promise.allSettled([
      this.workspaces.load(),
      this.models.loadProviders(),
      this.plugins.loadGlobal(),
      this.settings.load(),
      this.connection.loadPersistedConnection(),
      ...[...workspaceIds].map((id) => this.sessions.load(id)),
      this.sessions.state.activeSessionId &&
      !this.workspaces.isDraft(this.sessions.state.activeSessionId)
        ? this.sessions.loadMessages(this.sessions.state.activeSessionId)
        : Promise.resolve(),
    ])
  }

  async openWorkspace(id: string): Promise<void> {
    this.sessions.state.activeSessionId = null
    // Re-point the active workspace and the flat alias immediately (the cache
    // may be empty until load resolves); the activation hook lazy-loads the
    // workspace's plugins.
    this.sessions.setActiveWorkspace(id)
    await this.sessions.load(id)
  }

  async removeWorkspace(id: string): Promise<void> {
    await this.workspaces.removeWorkspaceRpc(id)
    // The server also emits workspace.updated on removal, so the event handler
    // performs the same cleanup; the explicit teardown here is an idempotent
    // safety net for when the event hasn't landed yet.
    this.sessions.clearWorkspace(id)
    this.workspaces.clearDraftsOfWorkspace(id)
    await this.workspaces.load()
  }

  /**
   * First message of a draft: create the real session server-side (autoTitle
   * so the LLM names it after this run), then send the prompt. The draft is
   * replaced by the persisted session node (createSession refetches the list).
   */
  async sendDraft(localId: string, text: string): Promise<void> {
    const draft = this.workspaces.state.drafts.find(
      (d) => d.localId === localId,
    )
    if (!draft) throw new Error("Draft session not found")
    // A draft's session is created with the chat model. Bail before
    // converting the draft so the composer stays put (message intact) instead
    // of stranding the user on an empty real session with no model to run.
    const chatModel = this.settings.state.settings.chatModel
    if (!chatModel) {
      throw new Error(
        "No model configured. Choose a chat model in Settings before starting a session.",
      )
    }
    const session = await this.sessions.createSession({
      workspaceId: draft.workspaceId,
      autoTitle: true,
      model: chatModel,
    })
    this.workspaces.state.drafts = this.workspaces.state.drafts.filter(
      (d) => d.localId !== localId,
    )
    await this.sessions.openSession(session.id)
    await this.chat.sendMessage(session.id, text)
  }
}

export const StoreKey: InjectionKey<Store> = Symbol("my-pi-store")

export function useStore(): Store {
  const store = inject(StoreKey)
  if (!store) throw new Error("Store not provided; call app.provide(StoreKey, store)")
  return store
}

// ---- focused store accessors (interface segregation) ----
// Each returns the typed domain store from the injected root. Consumers depend
// only on the focused surface they read, not the whole god store.

export function useConnectionStore(): ConnectionStore {
  return useStore().connection
}
export function useWorkspaceStore(): WorkspaceStore {
  return useStore().workspaces
}
export function useSessionStore(): SessionStore {
  return useStore().sessions
}
export function useChatStore(): ChatStore {
  return useStore().chat
}
export function useModelStore(): ModelStore {
  return useStore().models
}
export function useSettingsStore(): SettingsStore {
  return useStore().settings
}
export function usePluginStore(): PluginStore {
  return useStore().plugins
}
