import { RpcClient, type ConnectionState } from "../rpc/client"
import type { AppState } from "./state"
import { errMessage } from "./types"

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
  on(method: string, handler: (p: unknown) => void | Promise<void>): void {
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
}
