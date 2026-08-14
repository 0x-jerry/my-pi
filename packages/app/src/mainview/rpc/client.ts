import type { JsonRpcError } from "@my-pi/shared"

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

type Listener = (params: unknown) => void

/** Error carrying a JSON-RPC error object (code/message/data). */
export class RpcError extends Error {
  readonly code: number
  readonly data: unknown
  constructor(error: unknown) {
    const e = (
      typeof error === "object" && error !== null ? error : {}
    ) as Partial<JsonRpcError>
    super(typeof e.message === "string" ? e.message : "RPC error")
    this.name = "RpcError"
    this.code = typeof e.code === "number" ? e.code : -32603
    this.data = e.data
  }
}

/**
 * Minimal JSON-RPC 2.0 client over WebSocket.
 *
 * - `call()` correlates responses by incrementing id; rejects on JSON-RPC
 *   error objects and on transport failure (in-flight calls fail fast).
 * - Notifications (messages without an id) dispatch to `on(method, cb)`.
 * - Auto-reconnects with capped exponential backoff; `onRefreshAll` fires on
 *   every (re)connect so the store can resync.
 */
export class RpcClient {
  readonly url: string
  readonly token: string

  private socket: WebSocket | null = null
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >()
  private nextId = 1
  private listeners = new Map<string, Set<Listener>>()
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
      this.rejectPending(new Error("WebSocket connection closed"))
      this.setConnectionState("reconnecting")
      this.scheduleReconnect()
    }
  }

  /** Send a request and await its response. Rejects if disconnected. */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const ws = this.socket
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Not connected to server"))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      })
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    })
  }

  /** Subscribe to server→client notifications. Returns an unsubscribe fn. */
  on(method: string, listener: Listener): () => void {
    let set = this.listeners.get(method)
    if (!set) {
      set = new Set()
      this.listeners.set(method, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  /** Close permanently: no reconnect, pending calls reject. */
  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectPending(new Error("Client closed"))
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
    const obj = msg as {
      id?: unknown
      method?: unknown
      params?: unknown
      result?: unknown
      error?: unknown
    }
    // Response (has an id we issued)
    if (typeof obj.id === "number") {
      const entry = this.pending.get(obj.id)
      if (!entry) return
      this.pending.delete(obj.id)
      if (obj.error) entry.reject(new RpcError(obj.error as JsonRpcError))
      else entry.resolve(obj.result)
      return
    }
    // Notification (no id)
    if (typeof obj.method === "string") {
      const set = this.listeners.get(obj.method)
      if (set) {
        for (const listener of [...set]) listener(obj.params)
      }
    }
  }

  private rejectPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return
    this.connectionState = state
    this.onConnectionStateChange?.(state)
  }
}
