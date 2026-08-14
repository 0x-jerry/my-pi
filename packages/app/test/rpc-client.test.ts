import { afterEach, describe, expect, test, vi } from "vitest"
import { RpcClient, RpcError } from "../src/mainview/rpc/client"

/** Minimal WebSocket stand-in controllable from the test. */
class FakeWebSocket {
  static OPEN = 1
  readyState = 0 // CONNECTING
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.({})
  }
  // ---- test helpers ----
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.({})
  }
}

function lastSent<T = { method: string; id: number; params: unknown }>(ws: FakeWebSocket): T {
  return JSON.parse(ws.sent[ws.sent.length - 1]) as T
}

function setup() {
  const sockets: FakeWebSocket[] = []
  const client = new RpcClient({
    url: "ws://127.0.0.1:9999/ws",
    token: "secret",
    socketFactory: (url, token) => {
      const ws = new FakeWebSocket(url, token)
      sockets.push(ws)
      return ws as unknown as WebSocket
    },
  })
  return { client, sockets }
}

describe("RpcClient", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test("connect() opens a socket with url + token subprotocol and fires refreshAll", () => {
    const { client, sockets } = setup()
    const refreshAll = vi.fn()
    client.onRefreshAll = refreshAll

    client.connect()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe("ws://127.0.0.1:9999/ws")
    expect(sockets[0].protocols).toBe("secret")

    sockets[0].open()
    expect(client.connectionState).toBe("connected")
    expect(refreshAll).toHaveBeenCalledTimes(1)
    client.close()
  })

  test("correlates responses by id even when they arrive out of order", async () => {
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()

    const p1 = client.call("workspaces.list", {})
    const p2 = client.call("sessions.list", { workspaceId: "w1" })

    const id1 = JSON.parse(sockets[0].sent[0]) as { id: number }
    const id2 = JSON.parse(sockets[0].sent[1]) as { id: number }
    // Answer p2 first, then p1
    sockets[0].receive({ jsonrpc: "2.0", id: id2.id, result: [{ id: "s1" }] })
    sockets[0].receive({ jsonrpc: "2.0", id: id1.id, result: [{ id: "w1" }] })

    await expect(p2).resolves.toEqual([{ id: "s1" }])
    await expect(p1).resolves.toEqual([{ id: "w1" }])
    client.close()
  })

  test("rejects with RpcError on JSON-RPC error objects", async () => {
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()

    const p = client.call("chat.send", { sessionId: "s1", text: "hi" })
    const sent = lastSent<{ id: number }>(sockets[0])
    sockets[0].receive({
      jsonrpc: "2.0",
      id: sent.id,
      error: { code: -32602, message: "Invalid params" },
    })

    await expect(p).rejects.toBeInstanceOf(RpcError)
    await expect(p).rejects.toMatchObject({ code: -32602 })
    client.close()
  })

  test("rejects immediately when not connected", async () => {
    const { client } = setup()
    await expect(client.call("workspaces.list", {})).rejects.toThrow(
      "Not connected",
    )
  })

  test("rejects pending calls when the connection drops", async () => {
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()
    const p = client.call("chat.send", { sessionId: "s1", text: "hi" })
    sockets[0].drop()
    await expect(p).rejects.toThrow("closed")
    client.close()
  })

  test("dispatches notifications to registered listeners", async () => {
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()

    const statuses: unknown[] = []
    const unsubscribe = client.on("session.status", (p) => statuses.push(p))
    client.on("session.delta", () => {})

    sockets[0].receive({
      jsonrpc: "2.0",
      method: "session.status",
      params: { sessionId: "s1", status: "running" },
    })
    expect(statuses).toEqual([{ sessionId: "s1", status: "running" }])

    unsubscribe()
    sockets[0].receive({
      jsonrpc: "2.0",
      method: "session.status",
      params: { sessionId: "s1", status: "idle" },
    })
    expect(statuses).toHaveLength(1)
    client.close()
  })

  test("reconnects with backoff and calls refreshAll on each reconnect", async () => {
    vi.useFakeTimers()
    const { client, sockets } = setup()
    const refreshAll = vi.fn()
    client.onRefreshAll = refreshAll

    client.connect()
    sockets[0].open()
    expect(refreshAll).toHaveBeenCalledTimes(1)

    sockets[0].drop()
    expect(client.connectionState).toBe("reconnecting")

    // backoff resets on every successful open: next attempt after 500ms
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    expect(client.connectionState).toBe("connected")
    expect(refreshAll).toHaveBeenCalledTimes(2)

    // drop again (was open → backoff reset to 500ms)
    sockets[1].drop()
    await vi.advanceTimersByTimeAsync(400)
    expect(sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(100)
    expect(sockets).toHaveLength(3)

    // a failed attempt (no open between drops) doubles the backoff: 1000ms
    sockets[2].drop()
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(4)
    client.close()
  })

  test("close() is permanent: no reconnect, pending calls reject", async () => {
    vi.useFakeTimers()
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()

    const states: string[] = []
    client.onConnectionStateChange = (s) => states.push(s)

    client.close()
    expect(client.connectionState).toBe("closed")
    expect(states.at(-1)).toBe("closed")

    await vi.advanceTimersByTimeAsync(10_000)
    expect(sockets).toHaveLength(1) // no new sockets
    await expect(client.call("workspaces.list", {})).rejects.toThrow(
      "Not connected",
    )
  })

  test("close() while CONNECTING ignores a late open (no refreshAll, state stays closed)", async () => {
    const { client, sockets } = setup()
    const refreshAll = vi.fn()
    client.onRefreshAll = refreshAll
    const statuses: unknown[] = []
    client.on("session.status", (p) => statuses.push(p))

    client.connect()
    expect(sockets).toHaveLength(1)
    expect(client.connectionState).toBe("connecting")

    client.close()
    expect(client.connectionState).toBe("closed")

    // The socket resolves after the close: must be ignored.
    sockets[0].open()
    expect(client.connectionState).toBe("closed")
    expect(refreshAll).not.toHaveBeenCalled()

    // A late frame on the stale socket is ignored too.
    sockets[0].receive({
      jsonrpc: "2.0",
      method: "session.status",
      params: { sessionId: "s1", status: "running" },
    })
    expect(statuses).toHaveLength(0)
    await expect(client.call("workspaces.list", {})).rejects.toThrow(
      "Not connected",
    )
  })

  test("ignores malformed frames and unknown response ids", () => {
    const { client, sockets } = setup()
    client.connect()
    sockets[0].open()
    expect(() => sockets[0].receive("not json")).not.toThrow()
    expect(() => sockets[0].receive({ jsonrpc: "2.0", id: 999, result: 1 })).not.toThrow()
    client.close()
  })
})
