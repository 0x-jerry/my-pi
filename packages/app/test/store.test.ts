import { describe, expect, test } from "vitest"
import { RpcMethod } from "@my-pi/shared"
import { Store, type StreamingState } from "../src/mainview/store"
import type { RpcClient } from "../src/mainview/rpc/client"
import type { SessionInfo, StoredMessage, Workspace } from "@my-pi/shared"

/** Fake RpcClient: scriptable `call` handlers + direct notification emission. */
class FakeClient {
  onRefreshAll: (() => void) | null = null
  onConnectionStateChange: ((s: string) => void) | null = null
  private listeners = new Map<string, Set<(p: unknown) => void>>()
  calls: { method: string; params: unknown }[] = []
  handlers: Record<string, (params: any) => unknown> = {}
  connectionState = "closed"

  on(method: string, cb: (p: unknown) => void): () => void {
    let set = this.listeners.get(method)
    if (!set) {
      set = new Set()
      this.listeners.set(method, set)
    }
    set.add(cb)
    return () => set.delete(cb)
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params })
    const handler = this.handlers[method]
    if (!handler) throw new Error(`No test handler for ${method}`)
    return handler(params) as T
  }

  connect(): void {
    this.onRefreshAll?.()
  }

  emit(method: string, params: unknown): void {
    for (const cb of [...(this.listeners.get(method) ?? [])]) cb(params)
  }
}

function makeClient(): FakeClient {
  return new FakeClient()
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    workspaceId: "w1",
    title: "Test session",
    status: "idle",
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
    totalCost: 0,
    createdAt: 0,
    updatedAt: 0,
    lastActivityAt: 0,
    ...overrides,
  }
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "w1",
    name: "Workspace",
    path: "/tmp/ws",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "m-s1-1",
    sessionId: "s1",
    seq: 1,
    role: "assistant",
    data: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    createdAt: 0,
    ...overrides,
  }
}

function setup(handlers: Record<string, (params: any) => unknown> = {}) {
  const client = makeClient()
  for (const [method, fn] of Object.entries(handlers)) {
    client.handlers[method] = fn
  }
  const store = new Store(client as unknown as RpcClient)
  return { client, store }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("Store", () => {
  test("refreshAll loads workspaces, providers, plugins, settings", async () => {
    const { client, store } = setup({
      [RpcMethod.workspacesList]: () => [makeWorkspace()],
      [RpcMethod.modelsProviders]: () => [
        { id: "anthropic", name: "Anthropic", authConfigured: true },
      ],
      [RpcMethod.pluginsList]: () => [],
      [RpcMethod.settingsGetAll]: () => ({
        defaultModel: { provider: "anthropic", id: "claude" },
        defaultThinkingLevel: "high",
      }),
    })
    client.onRefreshAll?.()
    await flush()

    expect(store.state.workspaces).toHaveLength(1)
    expect(store.state.providers[0].id).toBe("anthropic")
    expect(store.state.settings.defaultModel).toEqual({
      provider: "anthropic",
      id: "claude",
    })
    expect(store.state.settings.defaultThinkingLevel).toBe("high")
  })

  test("createWorkspace refetches the workspace list", async () => {
    const ws = makeWorkspace()
    const { client, store } = setup({
      [RpcMethod.workspacesCreate]: () => ws,
      [RpcMethod.workspacesList]: () => [ws],
    })
    await store.createWorkspace("Workspace", "/tmp/ws")

    const methods = client.calls.map((c) => c.method)
    expect(methods).toEqual([
      RpcMethod.workspacesCreate,
      RpcMethod.workspacesList,
    ])
    expect(store.state.workspaces).toHaveLength(1)
  })

  test("removeWorkspace clears the active workspace and refetches", async () => {
    const { client, store } = setup({
      [RpcMethod.workspacesRemove]: () => undefined,
      [RpcMethod.workspacesList]: () => [],
    })
    store.state.activeWorkspaceId = "w1"
    store.state.activeSessionId = "s1"
    await store.removeWorkspace("w1")

    expect(store.state.activeWorkspaceId).toBeNull()
    expect(store.state.activeSessionId).toBeNull()
    expect(store.state.workspaces).toEqual([])
    expect(client.calls[0].method).toBe(RpcMethod.workspacesRemove)
  })

  test("createSession refetches sessions for the workspace", async () => {
    const s = makeSession()
    const { client, store } = setup({
      [RpcMethod.sessionsCreate]: () => s,
      [RpcMethod.sessionsList]: () => [s],
    })
    await store.createSession({ workspaceId: "w1" })

    const methods = client.calls.map((c) => c.method)
    expect(methods).toEqual([RpcMethod.sessionsCreate, RpcMethod.sessionsList])
    expect(store.state.sessions).toHaveLength(1)
  })

  test("deleteSession clears the active session and refetches", async () => {
    const { client, store } = setup({
      [RpcMethod.sessionsDelete]: () => undefined,
      [RpcMethod.sessionsList]: () => [],
    })
    store.state.activeWorkspaceId = "w1"
    store.state.activeSessionId = "s1"
    store.state.streaming.s1 = {
      status: "running",
      textBuf: "",
      thinkingBuf: "",
      parts: [],
      activeTool: null,
      pendingSend: null,
    } satisfies StreamingState

    await store.deleteSession("s1")
    expect(store.state.activeSessionId).toBeNull()
    expect(store.state.streaming.s1).toBeUndefined()
    expect(store.state.messagesBySession.s1).toBeUndefined()
    expect(store.state.lastUsage.s1).toBeUndefined()
    expect(client.calls.some((c) => c.method === RpcMethod.sessionsList)).toBe(true)
  })

  test("notification: status running initializes streaming and resets buffers", async () => {
    const { client, store } = setup()
    store.state.streaming.s1 = {
      status: "idle",
      textBuf: "stale",
      thinkingBuf: "stale",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    client.emit("session.status", { sessionId: "s1", status: "running" })
    await flush()

    const st = store.state.streaming.s1
    expect(st.status).toBe("running")
    expect(st.textBuf).toBe("")
    expect(st.thinkingBuf).toBe("")
  })

  test("notification: deltas append to text and thinking buffers", () => {
    const { client, store } = setup()
    client.emit("session.delta", { sessionId: "s1", kind: "text", delta: "hel" })
    client.emit("session.delta", { sessionId: "s1", kind: "text", delta: "lo" })
    client.emit("session.delta", { sessionId: "s1", kind: "thinking", delta: "hm" })

    const st = store.state.streaming.s1
    expect(st.textBuf).toBe("hello")
    expect(st.thinkingBuf).toBe("hm")
  })

  test("notification: tool lifecycle populates activeTool", () => {
    const { client, store } = setup()
    client.emit("session.tool_start", {
      sessionId: "s1",
      toolCallId: "tc1",
      toolName: "bash",
      args: { cmd: "ls" },
    })
    client.emit("session.tool_update", {
      sessionId: "s1",
      toolCallId: "tc1",
      partialResult: "partial",
    })
    client.emit("session.tool_end", {
      sessionId: "s1",
      toolCallId: "tc1",
      isError: false,
      result: "done",
    })

    expect(store.state.streaming.s1.activeTool).toMatchObject({
      toolName: "bash",
      args: { cmd: "ls" },
      partialResult: "partial",
      result: "done",
      isError: false,
    })
  })

  test("notification: message_end appends and clears assistant buffers", () => {
    const { client, store } = setup()
    store.state.streaming.s1 = {
      status: "running",
      textBuf: "streamed",
      thinkingBuf: "thought",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    client.emit("session.message_end", {
      sessionId: "s1",
      message: makeMessage(),
    })

    expect(store.messagesFor("s1")).toHaveLength(1)
    expect(store.state.streaming.s1.textBuf).toBe("")
    expect(store.state.streaming.s1.thinkingBuf).toBe("")
  })

  test("notification: run_end reconciles by id (idempotent) and clears streaming", async () => {
    const { client, store } = setup()
    const m1 = makeMessage({ id: "m-s1-1", seq: 1 })
    const m2 = makeMessage({ id: "m-s1-2", seq: 2, role: "user", data: { role: "user", content: "q" } })

    // Duplicate message_end pushes for m1 (server re-settle) then run_end.
    client.emit("session.message_end", { sessionId: "s1", message: m1 })
    client.emit("session.message_end", { sessionId: "s1", message: m1 })
    client.emit("session.run_end", {
      sessionId: "s1",
      messages: [m1, m2],
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: 0.001 },
      error: undefined,
      aborted: false,
    })
    await flush()

    expect(store.messagesFor("s1")).toHaveLength(2)
    expect(store.messagesFor("s1").map((m) => m.id)).toEqual(["m-s1-1", "m-s1-2"])
    expect(store.state.lastUsage.s1?.totalTokens).toBe(30)
    expect(store.state.streaming.s1.pendingSend).toBeNull()
  })

  test("sendMessage keeps pendingSend until run_end; error surfaces on RPC failure", async () => {
    const { client, store } = setup({
      [RpcMethod.chatSend]: () => undefined,
    })
    store.state.activeWorkspaceId = "w1"
    store.state.activeSessionId = "s1"
    const p = store.sendMessage("s1", "hello")
    expect(store.state.streaming.s1.pendingSend).toBe("hello")
    await p

    // RPC resolves at settle; run_end clears the optimistic message.
    client.emit("session.run_end", {
      sessionId: "s1",
      messages: [makeMessage()],
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: 0 },
      error: undefined,
      aborted: false,
    })
    await flush()
    expect(store.state.streaming.s1.pendingSend).toBeNull()

    // Failure path
    client.handlers[RpcMethod.chatSend] = () => {
      throw new Error("Agent is busy")
    }
    await expect(store.sendMessage("s1", "again")).rejects.toThrow("busy")
    expect(store.state.streaming.s1.status).toBe("error")
    expect(store.state.streaming.s1.error).toContain("busy")
  })

  test("notification: session.status error sets streaming error state", async () => {
    const { client, store } = setup()
    client.emit("session.status", {
      sessionId: "s1",
      status: "error",
      error: "model unavailable",
    })
    await flush()
    expect(store.state.streaming.s1.status).toBe("error")
    expect(store.state.streaming.s1.error).toBe("model unavailable")
  })

  test("notification: workspace.updated refetches and clears removed workspace", async () => {
    const { client, store } = setup({
      [RpcMethod.workspacesList]: () => [],
    })
    store.state.activeWorkspaceId = "w1"
    store.state.activeSessionId = "s1"
    client.emit("workspace.updated", { workspaceId: "w1" })
    await flush()

    expect(store.state.workspaces).toEqual([])
    expect(store.state.activeWorkspaceId).toBeNull()
  })

  test("abort delegates to chat.abort", async () => {
    const { client, store } = setup({
      [RpcMethod.chatAbort]: () => undefined,
    })
    await store.abort("s1")
    expect(client.calls[0]).toMatchObject({
      method: RpcMethod.chatAbort,
      params: { sessionId: "s1" },
    })
  })

  test("openSession loads messages for the session", async () => {
    const m = makeMessage()
    const { store } = setup({
      [RpcMethod.sessionsMessages]: () => [m],
    })
    store.state.activeSessionId = "s1"
    await store.openSession("s1")
    expect(store.state.activeSessionId).toBe("s1")
    expect(store.messagesFor("s1")).toEqual([m])
  })

  test("setPluginEnabled refetches global + workspace plugin lists", async () => {
    const { client, store } = setup({
      [RpcMethod.pluginsSetEnabled]: () => undefined,
      [RpcMethod.pluginsList]: () => [],
    })
    store.state.activeWorkspaceId = "w1"
    await store.setPluginEnabled("p1", true)
    expect(client.calls[0].method).toBe(RpcMethod.pluginsSetEnabled)
    expect(client.calls.some((c) => c.method === RpcMethod.pluginsList)).toBe(true)
  })

  test("settings setters persist and update local state", async () => {
    const { client, store } = setup({
      [RpcMethod.settingsSet]: () => undefined,
    })
    await store.setDefaultModel({ provider: "anthropic", id: "claude" })
    await store.setChatModel({ provider: "openai", id: "gpt-5" })
    await store.setTitleModel(null)
    await store.setDefaultThinkingLevel("high")
    expect(store.state.settings.defaultModel).toEqual({
      provider: "anthropic",
      id: "claude",
    })
    expect(store.state.settings.chatModel).toEqual({
      provider: "openai",
      id: "gpt-5",
    })
    expect(store.state.settings.titleModel).toBeUndefined()
    expect(store.state.settings.defaultThinkingLevel).toBe("high")
    expect(client.calls.every((c) => c.method === RpcMethod.settingsSet)).toBe(true)
  })

  test("settings load applies the server-validated snapshot", async () => {
    const { store } = setup({
      [RpcMethod.settingsGetAll]: () => ({
        chatModel: { provider: "a", id: "b" },
        defaultModel: null, // stored-but-cleared -> absent
        titleModel: { provider: "a", id: "t" },
        defaultThinkingLevel: "high",
        unknownKey: 123, // not a managed key -> never looked up
      }),
    })
    await store.loadSettings()
    expect(store.state.settings.chatModel).toEqual({ provider: "a", id: "b" })
    expect(store.state.settings.defaultModel).toBeUndefined()
    expect(store.state.settings.titleModel).toEqual({ provider: "a", id: "t" })
    expect(store.state.settings.defaultThinkingLevel).toBe("high")
    expect(Object.keys(store.state.settings)).not.toContain("unknownKey")
  })

  test("refreshAll re-syncs the active workspace sessions and session transcript", async () => {
    const s = makeSession()
    const m = makeMessage()
    const { client, store } = setup({
      [RpcMethod.workspacesList]: () => [makeWorkspace()],
      [RpcMethod.modelsProviders]: () => [],
      [RpcMethod.pluginsList]: () => [],
      [RpcMethod.settingsGetAll]: () => ({}),
      [RpcMethod.sessionsList]: () => [s],
      [RpcMethod.sessionsMessages]: () => [m],
    })
    store.state.activeWorkspaceId = "w1"
    store.state.activeSessionId = "s1"

    await store.refreshAll()

    expect(store.state.sessions).toEqual([s])
    expect(store.messagesFor("s1")).toEqual([m])
    const methods = client.calls.map((c) => c.method)
    expect(methods).toContain(RpcMethod.sessionsList)
    expect(methods).toContain(RpcMethod.sessionsMessages)
  })

  test("zero-usage run_end (re-settle) does not clobber the last real usage", async () => {
    const { client, store } = setup()
    store.state.lastUsage.s1 = {
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: 0.001,
    }
    client.emit("session.run_end", {
      sessionId: "s1",
      messages: [makeMessage()],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: 0,
      },
      error: undefined,
      aborted: false,
    })
    await flush()
    expect(store.state.lastUsage.s1?.totalTokens).toBe(30)
  })

  test("status running updates the local session row without refetching; idle refetches", async () => {
    const s = makeSession()
    const { client, store } = setup({
      [RpcMethod.sessionsList]: () => [makeSession({ status: "idle" })],
    })
    store.state.activeWorkspaceId = "w1"
    store.state.sessions = [s]

    client.emit("session.status", { sessionId: "s1", status: "running" })
    expect(store.state.sessions[0].status).toBe("running")
    // no refetch on the running transition
    expect(client.calls.filter((c) => c.method === RpcMethod.sessionsList)).toHaveLength(0)

    client.emit("session.status", { sessionId: "s1", status: "idle" })
    await flush()
    expect(
      client.calls.filter((c) => c.method === RpcMethod.sessionsList).length,
    ).toBeGreaterThan(0)
  })

  test("tool_start freezes the current buffers into parts and resets them", () => {
    const { client, store } = setup()
    store.state.streaming.s1 = {
      status: "running",
      textBuf: "answer so far",
      thinkingBuf: "thought",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    client.emit("session.tool_start", {
      sessionId: "s1",
      toolCallId: "tc1",
      toolName: "bash",
      args: {},
    })

    const st = store.state.streaming.s1
    expect(st.parts).toEqual([{ text: "answer so far", thinking: "thought" }])
    expect(st.textBuf).toBe("")
    expect(st.thinkingBuf).toBe("")
    expect(st.activeTool).toMatchObject({ toolName: "bash" })
  })

  test("drafts: start/open/discard lifecycle is local-only", () => {
    const { client, store } = setup()
    const id = store.startDraft("w1")
    expect(store.isDraft(id)).toBe(true)
    expect(store.state.drafts).toEqual([{ localId: id, workspaceId: "w1" }])

    store.openDraft(id)
    expect(store.state.activeSessionId).toBe(id)

    store.discardDraft(id)
    expect(store.isDraft(id)).toBe(false)
    expect(store.state.drafts).toEqual([])
    expect(store.state.activeSessionId).toBeNull()
    expect(client.calls).toHaveLength(0)
  })

  test("sendDraft creates the real session, clears the draft, opens and sends", async () => {
    const s = makeSession()
    const { client, store } = setup({
      [RpcMethod.sessionsCreate]: () => s,
      [RpcMethod.sessionsList]: () => [s],
      [RpcMethod.sessionsMessages]: () => [],
      [RpcMethod.chatSend]: () => undefined,
    })
    store.state.activeWorkspaceId = "w1"
    store.state.settings.chatModel = { provider: "anthropic", id: "claude" }
    const id = store.startDraft("w1")
    store.openDraft(id)

    await store.sendDraft(id, "hello world")

    expect(store.state.drafts).toEqual([])
    expect(store.state.activeSessionId).toBe("s1")
    const createCall = client.calls.find((c) => c.method === RpcMethod.sessionsCreate)
    expect(createCall?.params).toEqual({
      workspaceId: "w1",
      autoTitle: true,
      model: { provider: "anthropic", id: "claude" },
    })
    const sendCall = client.calls.find((c) => c.method === RpcMethod.chatSend)
    expect(sendCall?.params).toEqual({ sessionId: "s1", text: "hello world" })
    expect(client.calls.some((c) => c.method === RpcMethod.sessionsList)).toBe(true)
  })

  test("sendDraft keeps the draft when no chat model is configured", async () => {
    const { client, store } = setup({
      [RpcMethod.sessionsCreate]: () => {
        throw new Error("should not be called")
      },
    })
    store.state.activeWorkspaceId = "w1"
    const id = store.startDraft("w1")
    store.openDraft(id)

    await expect(store.sendDraft(id, "hi")).rejects.toThrow(
      "No model configured",
    )
    expect(store.isDraft(id)).toBe(true)
    expect(store.state.activeSessionId).toBe(id)
    expect(client.calls).toHaveLength(0)
  })

  test("sendDraft keeps the draft when session creation fails", async () => {
    const { store } = setup({
      [RpcMethod.sessionsCreate]: () => {
        throw new Error("boom")
      },
    })
    store.state.settings.chatModel = { provider: "anthropic", id: "claude" }
    const id = store.startDraft("w1")
    store.openDraft(id)

    await expect(store.sendDraft(id, "hi")).rejects.toThrow("boom")
    expect(store.isDraft(id)).toBe(true)
    expect(store.state.activeSessionId).toBe(id)
  })

  test("title_updated notification patches the session row in place", () => {
    const { client, store } = setup()
    store.state.sessions = [makeSession({ title: "New session", updatedAt: 100 })]
    client.emit("session.title_updated", {
      sessionId: "s1",
      title: "Refactor the sidebar",
      updatedAt: 200,
    })
    expect(store.state.sessions[0].title).toBe("Refactor the sidebar")
    expect(store.state.sessions[0].updatedAt).toBe(200)
  })

  test("refreshAll skips message load for a draft session", async () => {
    const s = makeSession()
    const { client, store } = setup({
      [RpcMethod.workspacesList]: () => [makeWorkspace()],
      [RpcMethod.modelsProviders]: () => [],
      [RpcMethod.pluginsList]: () => [],
      [RpcMethod.settingsGetAll]: () => ({}),
      [RpcMethod.sessionsList]: () => [s],
    })
    store.state.activeWorkspaceId = "w1"
    const id = store.startDraft("w1")
    store.openDraft(id)

    await store.refreshAll()

    expect(
      client.calls.some((c) => c.method === RpcMethod.sessionsMessages),
    ).toBe(false)
  })

  test("removeWorkspace clears drafts of that workspace", async () => {
    const { store } = setup({
      [RpcMethod.workspacesRemove]: () => undefined,
      [RpcMethod.workspacesList]: () => [],
    })
    store.startDraft("w1")
    store.startDraft("w2")
    store.state.activeWorkspaceId = "w1"

    await store.removeWorkspace("w1")

    expect(store.state.drafts.map((d) => d.workspaceId)).toEqual(["w2"])
  })
})
