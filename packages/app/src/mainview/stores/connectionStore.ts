import { RpcClient, type ConnectionState } from "../rpc/client"
import type { RpcNotifications } from "@my-pi/shared"
import type { AppState } from "./state"
import { errMessage } from "./types"
import { useLocalStorage } from "@vueuse/core"

/** User-configured connection settings (persisted client-side in localStorage). */
export interface ConnectionConfig {
  /** Full ws:// URL of the core JSON-RPC server (/ws path). */
  endpoint: string
  /** Auth token, presented as the WebSocket subprotocol. */
  token: string
}

const STORAGE_KEY = "my-pi:connection"

/**
 * Reactive localStorage-backed ref for the persisted connection config.
 * Reads/writes the underlying storage automatically.
 */
const storedConfig = useLocalStorage<ConnectionConfig | null>(STORAGE_KEY, null)

/**
 * Owns the RpcClient and the connection lifecycle: connect/init, the
 * connection-state callback, and wrapped notification-handler registration
 * with unhandled-rejection protection surfaced into the global error banner.
 */
export class ConnectionStore {
  readonly client: RpcClient
  readonly state: AppState

  constructor(state: AppState, client: RpcClient) {
    this.state = state
    this.client = client
    client.onConnectionStateChange = (s: ConnectionState) => {
      state.connectionState = s
    }
  }

  /** Register a notification handler with unhandled-rejection protection. */
  on<M extends keyof RpcNotifications & string>(
    method: M,
    handler: (p: RpcNotifications[M]) => void | Promise<void>,
  ): void {
    this.client.on(method, (p) => {
      try {
        const result = handler(p)
        if (result instanceof Promise) {
          result.catch((err) => {
            this.state.error = errMessage(err)
          })
        }
      } catch (err) {
        this.state.error = errMessage(err)
      }
    })
  }

  /** Start the connection; `refreshAll()` runs on first connect. */
  init(): void {
    this.client.connect()
  }

  /** The endpoint + token the client is currently (re)configured to use. */
  get endpoint(): string {
    return this.client.url
  }
  get token(): string {
    return this.client.token
  }

  /**
   * Apply a user-configured endpoint + token: persist it client-side
   * (localStorage only; no backend round-trip) and reconnect. Pending
   * requests are rejected while the new connection is established.
   */
  async applyConnection(config: ConnectionConfig): Promise<void> {
    storedConfig.value = config
    this.client.reconnect(config.endpoint, config.token)
  }

  /**
   * Re-read the persisted (localStorage) connection config and reconnect if
   * it differs from the current endpoint (e.g. the shell-provided default).
   * No-op when none is stored or the endpoint already matches.
   */
  async loadPersistedConnection(): Promise<void> {
    const stored = storedConfig.value
    if (!stored || !stored.endpoint) return
    if (stored.endpoint !== this.client.url) {
      this.client.reconnect(stored.endpoint, stored.token)
    }
  }
}
