import { reactive } from "vue"
import { describe, expect, test, vi } from "vitest"
import { mount } from "@vue/test-utils"
import ElementPlus from "element-plus"
import ChatView from "../src/mainview/components/ChatView.vue"
import { StoreKey } from "../src/mainview/store"
import type { SessionInfo, StoredMessage } from "@my-pi/shared"

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    workspaceId: "w1",
    title: "Test session",
    status: "idle",
    modelProvider: "anthropic",
    modelId: "claude",
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

function message(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "m-s1-1",
    sessionId: "s1",
    seq: 1,
    role: "assistant",
    data: { role: "assistant", content: [{ type: "text", text: "hello world" }] },
    createdAt: 0,
    ...overrides,
  }
}

interface FakeChatState {
  streaming: Record<string, {
    status: "idle" | "running" | "stopped" | "error"
    error?: string
    textBuf: string
    thinkingBuf: string
    parts: { text: string; thinking: string }[]
    activeTool: { toolName: string; args: unknown } | null
    pendingSend: string | null
  }>
  lastUsage: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>
}

interface FakeStoreState {
  sessions: SessionInfo[]
  messagesBySession: Record<string, StoredMessage[]>
  chat: Partial<FakeChatState>
}

function fakeStore(overrides: Partial<FakeStoreState> = {}) {
  // The refactored store exposes focused sub-stores: consumers read sessions
  // (list + transcripts) and chat (streaming + usage) separately.
  const sessionsState = reactive({
    sessions: [session()],
    messagesBySession: {},
    ...(overrides.sessions !== undefined
      ? { sessions: overrides.sessions }
      : {}),
    ...(overrides.messagesBySession !== undefined
      ? { messagesBySession: overrides.messagesBySession }
      : {}),
  })
  const chatState = reactive({
    streaming: {},
    lastUsage: {},
    ...(overrides.chat?.streaming !== undefined
      ? { streaming: overrides.chat.streaming }
      : {}),
    ...(overrides.chat?.lastUsage !== undefined
      ? { lastUsage: overrides.chat.lastUsage }
      : {}),
  })

  const store = {
    sessions: {
      state: sessionsState,
      forkSession: vi.fn(async () => ({ id: "fork1" })),
      openSession: vi.fn(async () => {}),
      updateModel: vi.fn(async () => ({})),
    },
    models: {
      state: reactive({ providers: [], models: {} }),
      listModels: vi.fn(async () => []),
      loadProviders: vi.fn(async () => {}),
      loginApiKey: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
    },
    chat: {
      state: chatState,
      streamingFor: (id: string) =>
        chatState.streaming[id] ?? {
          status: "idle",
          textBuf: "",
          thinkingBuf: "",
          parts: [],
          activeTool: null,
          pendingSend: null,
        },
      sendMessage: vi.fn(async () => {}),
      steer: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    },
  }
  return store
}

function mountChat(store: ReturnType<typeof fakeStore>) {
  return mount(ChatView, {
    props: { sessionId: "s1" },
    global: {
      plugins: [ElementPlus],
      provide: { [StoreKey]: store },
    },
  })
}

describe("ChatView", () => {
  test("renders persisted messages: text, thinking, toolCall, toolResult, image", () => {
    const store = fakeStore()
    store.sessions.state.messagesBySession.s1 = [
      message({
        id: "m-s1-1",
        role: "user",
        data: { role: "user", content: "what is 2+2?" },
      }),
      message({
        id: "m-s1-2",
        role: "assistant",
        data: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "let me think" },
            { type: "toolCall", id: "tc1", name: "bash", arguments: { cmd: "echo 4" } },
            { type: "text", text: "the answer is 4" },
          ],
        },
      }),
      message({
        id: "m-s1-3",
        role: "toolResult",
        data: {
          role: "toolResult",
          toolName: "bash",
          isError: false,
          content: [{ type: "text", text: "4" }],
        },
      }),
    ]
    const wrapper = mountChat(store)

    expect(wrapper.text()).toContain("what is 2+2?")
    expect(wrapper.text()).toContain("let me think")
    expect(wrapper.text()).toContain("the answer is 4")
    expect(wrapper.text()).toContain("bash")
    expect(wrapper.text()).toContain("echo 4")
    expect(wrapper.text()).toContain('"cmd"')
  })

  test("renders images as data URIs", () => {
    const store = fakeStore()
    store.sessions.state.messagesBySession.s1 = [
      message({
        id: "m-s1-1",
        role: "user",
        data: {
          role: "user",
          content: [{ type: "image", mimeType: "image/png", data: "iVBORw0=" }],
        },
      }),
    ]
    const wrapper = mountChat(store)
    const img = wrapper.find("img.image")
    expect(img.exists()).toBe(true)
    expect(img.attributes("src")).toBe("data:image/png;base64,iVBORw0=")
  })

  test("streams live text, thinking and active tool while running", async () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "running",
      textBuf: "streaming…",
      thinkingBuf: "thinking…",
      parts: [],
      activeTool: { toolName: "bash", args: { cmd: "ls" } },
      pendingSend: "my question",
    }
    const wrapper = mountChat(store)

    expect(wrapper.text()).toContain("my question")
    expect(wrapper.text()).toContain("streaming…")
    expect(wrapper.text()).toContain("thinking…")
    expect(wrapper.text()).toContain("bash")
    // Abort control is available while running
    expect(wrapper.text()).toContain("Abort")
  })

  test("abort button calls store.abort with the session id", async () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "running",
      textBuf: "",
      thinkingBuf: "",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    const wrapper = mountChat(store)
    await wrapper.find("button.el-button--danger").trigger("click")
    expect(store.chat.abort).toHaveBeenCalledWith("s1")
  })

  test("send calls store.sendMessage and clears the input", async () => {
    const store = fakeStore()
    const wrapper = mountChat(store)
    const textarea = wrapper.find("textarea")
    await textarea.setValue("hello pi")
    await wrapper.find("button.el-button--primary").trigger("click")

    expect(store.chat.sendMessage).toHaveBeenCalledWith("s1", "hello pi")
    expect((textarea.element as HTMLTextAreaElement).value).toBe("")
  })

  test("send is disabled while streaming", async () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "running",
      textBuf: "…",
      thinkingBuf: "",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    const wrapper = mountChat(store)
    const sendBtn = wrapper.find("button.el-button--primary")
    expect((sendBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  test("shows last-run usage in the footer", () => {
    const store = fakeStore()
    store.chat.state.lastUsage.s1 = {
      input: 10,
      output: 20,
      cacheRead: 5,
      cacheWrite: 0,
      cost: 0.0012,
    }
    const wrapper = mountChat(store)
    expect(wrapper.text()).toContain("last run")
    expect(wrapper.text()).toContain("$0.0012")
  })

  test("surfaces the streaming error banner", () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "error",
      error: "model unavailable",
      textBuf: "",
      thinkingBuf: "",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    const wrapper = mountChat(store)
    expect(wrapper.text()).toContain("model unavailable")
  })

  test("shows the empty hint when there are no messages", () => {
    const store = fakeStore()
    const wrapper = mountChat(store)
    expect(wrapper.text()).toContain("Send a message to start")
  })

  test("empty hint is hidden during thinking-only streaming", () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "running",
      thinkingBuf: "thinking…",
      textBuf: "",
      parts: [],
      activeTool: null,
      pendingSend: null,
    }
    const wrapper = mountChat(store)
    expect(wrapper.text()).not.toContain("Send a message to start")
    expect(wrapper.text()).toContain("thinking…")
  })

  test("renders completed streamed parts frozen at tool boundaries", () => {
    const store = fakeStore()
    store.chat.state.streaming.s1 = {
      status: "running",
      textBuf: "second part…",
      thinkingBuf: "",
      parts: [{ text: "first part", thinking: "thought" }],
      activeTool: null,
      pendingSend: null,
    }
    const wrapper = mountChat(store)
    expect(wrapper.text()).toContain("first part")
    expect(wrapper.text()).toContain("thought")
    expect(wrapper.text()).toContain("second part…")
  })

  test("renders tool-result images as data URIs", () => {
    const store = fakeStore()
    store.sessions.state.messagesBySession.s1 = [
      message({
        id: "m-s1-1",
        role: "toolResult",
        data: {
          role: "toolResult",
          toolName: "screenshot",
          isError: false,
          content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }],
        },
      }),
    ]
    const wrapper = mountChat(store)
    const img = wrapper.find("img.image")
    expect(img.exists()).toBe(true)
    expect(img.attributes("src")).toBe("data:image/png;base64,aGVsbG8=")
  })
})
