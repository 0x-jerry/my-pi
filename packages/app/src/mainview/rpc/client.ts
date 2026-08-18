import { JsonRpcClient } from "@0x-jerry/utils"
import type { RpcMethods, RpcNotifications } from "@my-pi/shared"

export type ConnectionState = "closed" | "connecting" | "connected" | "reconnecting"

export interface RpcClientOptions {
  /** ws:// URL of the core JSON-RPC server (/ws path). */
  url: string
  /** Auth token, presented as the WebSocket subprotocol. */
  token: string
  /**
   * Injectable socket factory (used by tests to substitute a fake WebSocket).
   * Defaults to the browser/global WebSocket with the token as subprotocol.
   */
  socketFactory?: (url: string, token: string) => WebSocket
  /** Initial reconnect delay; doubles up to max. Default 500ms → 5000ms. */
  backoffMinMs?: number
  backoffMaxMs?: number
}

type FanoutListener = (params: unknown) => void

/**
 * JSON-RPC 2.0 client over WebSocket.
 *
 * The transport (connect/reconnect with capped exponential backoff,
 * connection state, `onRefreshAll`) lives here; the JSON-RPC protocol
 * layer (request correlation, notification dispatch) is delegated to
 * `JsonRpcClient` from `@0x-jerry/utils`, typed by the shared
 * `RpcMethods`/`RpcNotifications` contracts.
 *
 * - `call()` rejects on JSON-RPC error objects and on transport failure
 *   (in-flight calls fail fast).
 * - Notifications dispatch to `on(method, cb)`.
 * - Auto-reconnects with capped exponential backoff; `onRefreshAll` fires on
 *   every (re)connect so the store can resync.
 */
export class RpcClient {
  url: string
  token: string

  private socket: WebSocket | null = null
  private jsonrpc: JsonRpcClient
  /** Our own notification registry so subscriptions survive engine swaps. */
  private listeners = new Map<string, Set<FanoutListener>>()
  private minBackoffMs: number
  private maxBackoffMs: number
  private backoffMs: number
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private socketFactory: (url: string, token: string) => WebSocket

  connectionState: ConnectionState = "closed"
  /** Called on every successful (re)connect. */
  onRefreshAll: (() => void) | null = null
  /** Called whenever `connectionState` changes. */
  onConnectionStateChange: ((state: ConnectionState) => void) | null = null

  constructor(opts: RpcClientOptions) {
    this.url = opts.url
    this.token = opts.token
    this.socketFactory =
      opts.socketFactory ?? ((url, token) => new WebSocket(url, token))
    this.minBackoffMs = opts.backoffMinMs ?? 500
    this.maxBackoffMs = opts.backoffMaxMs ?? 5000
    this.backoffMs = this.minBackoffMs
    this.jsonrpc = this.makeJsonrpc()
  }

  /** Build a protocol engine bound to the current socket. */
  private makeJsonrpc(): JsonRpcClient {
    const jsonrpc = new JsonRpcClient((message) => {
      const ws = this.socket
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    })
    // Fan-out handlers read from `this.listeners`, so they survive engine
    // swaps (reconnect / reconfigure replace the engine instance).
    for (const method of this.listeners.keys()) {
      this.registerFanout(jsonrpc, method)
    }
    return jsonrpc
  }

  private registerFanout(jsonrpc: JsonRpcClient, method: string): void {
    jsonrpc.onNotification(method, (params) => {
      const set = this.listeners.get(method)
      if (!set) return
      for (const listener of [...set]) listener(params)
    })
  }

  /** Dispose the current engine's in-flight calls and swap in a fresh one. */
  private swapEngine(err: Error): void {
    this.jsonrpc.dispose(err)
    this.jsonrpc = this.makeJsonrpc()
  }

  /**
   * Reconfigure the endpoint + token and reconnect (used when the user
   * changes connection settings). Pending requests are rejected and any
   * in-flight/heartbeat socket is replaced. The client is not permanently
   * closed, so it keeps auto-reconnecting to the new endpoint.
   */
  reconnect(url: string, token: string): void {
    this.closed = false
    this.url = url
    this.token = token
    this.backoffMs = this.minBackoffMs
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.swapEngine(new Error("Client reconfiguring"))
    const ws = this.socket
    this.socket = null
    ws?.close()
    this.setConnectionState("closed")
    this.connect()
  }

  /** Open the connection (idempotent; no-op while already connecting/connected). */
  connect(): void {
    if (this.closed) return
    if (this.socket) return
    this.setConnectionState(
      this.connectionState === "reconnecting" ? "reconnecting" : "connecting",
    )
    const ws = this.socketFactory(this.url, this.token)
    this.socket = ws

    ws.onopen = () => {
      if (this.closed || this.socket !== ws) return
      this.backoffMs = this.minBackoffMs
      this.setConnectionState("connected")
      this.onRefreshAll?.()
    }
    ws.onmessage = (event) => {
      if (this.closed || this.socket !== ws) return
      this.handleMessage(event.data)
    }
    ws.onerror = () => {
      // Errors surface via onclose, which drives reconnect.
    }
    ws.onclose = () => {
      // Ignore stale sockets (closed deliberately or replaced by a reconnect).
      if (this.closed || this.socket !== ws) return
      this.socket = null
      this.swapEngine(new Error("WebSocket connection closed"))
      this.setConnectionState("reconnecting")
      this.scheduleReconnect()
    }
  }

  /** Send a request and await its response. Rejects if disconnected. */
  call<M extends keyof RpcMethods & string>(
    method: M,
    params?: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]> {
    const ws = this.socket
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to server"))
    }
    return this.jsonrpc.call(method, params) as Promise<
      RpcMethods[M]["result"]
    >
  }

  /**
   * Subscribe to server→client notifications. Returns an unsubscribe fn.
   * The listener's params are typed by the `RpcNotifications` contract.
   */
  on<M extends keyof RpcNotifications & string>(
    method: M,
    listener: (params: RpcNotifications[M]) => void,
  ): () => void {
    if (!this.listeners.has(method)) {
      const set = new Set<FanoutListener>()
      this.listeners.set(method, set)
      this.registerFanout(this.jsonrpc, method)
    }
    this.listeners.get(method)!.add(listener as FanoutListener)
    return () => {
      this.listeners.get(method)?.delete(listener as FanoutListener)
    }
  }

  /** Close permanently: no reconnect, pending calls reject. */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.jsonrpc.dispose(new Error("Client closed"))
    const ws = this.socket
    this.socket = null
    ws?.close()
    this.setConnectionState("closed")
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
  }

  private handleMessage(raw: unknown): void {
    let msg: unknown
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    this.jsonrpc.handleMessage(msg)
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return
    this.connectionState = state
    this.onConnectionStateChange?.(state)
  }
}
