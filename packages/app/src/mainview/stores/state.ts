import { reactive } from "vue"
import type {
  ModelInfo,
  PluginInfo,
  ProviderInfo,
  SessionInfo,
  StoredMessage,
  UsageSummary,
  Workspace,
} from "@my-pi/shared"
import type { ConnectionState } from "../rpc/client"
import type { DraftSession, SettingsState, StreamingState } from "./types"

/**
 * A single shared reactive state object across all domain stores. Keeping one
 * `reactive` graph (rather than one per store) preserves the existing read
 * sites (computed dependents observe the same object) and the exact state
 * shape, so splitting the store is behavior-preserving.
 */
export function createState() {
  return reactive({
    connectionState: "closed" as ConnectionState,
    workspaces: [] as Workspace[],
    activeWorkspaceId: null as string | null,
    sessions: [] as SessionInfo[],
    activeSessionId: null as string | null,
    drafts: [] as DraftSession[],
    messagesBySession: {} as Record<string, StoredMessage[]>,
    streaming: {} as Record<string, StreamingState>,
    lastUsage: {} as Record<string, UsageSummary | undefined>,
    providers: [] as ProviderInfo[],
    models: {} as Record<string, ModelInfo[]>,
    pluginsGlobal: [] as PluginInfo[],
    pluginsWorkspace: {} as Record<string, PluginInfo[]>,
    settings: {} as SettingsState,
    /** Global error banner (boot failures, send errors, etc.). */
    error: null as string | null,
  })
}

export type AppState = ReturnType<typeof createState>
