import { reactive } from "vue"
import {
  RpcEvent,
  RpcMethod,
  type RpcNotifications,
  type UsageSummary,
} from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { SessionStore } from "./sessionStore"
import type { RpcClient } from "../rpc/client"
import { emptyStreaming, type StreamingState } from "./types"

/** Chat slice: per-session streaming state and usage. Owned by ChatStore. */
function createChatState() {
  return reactive({
    streaming: {} as Record<string, StreamingState>,
    lastUsage: {} as Record<string, UsageSummary | undefined>,
  })
}
export type ChatStateSlice = ReturnType<typeof createChatState>

/**
 * Chat domain: per-session streaming state and usage, the send / steer /
 * follow-up / abort actions, and the live notification handlers
 * (status/delta/tool/message/run/title). Transcript writes go through the
 * session store's `upsertMessage`/`reconcileMessages` primitives and session
 * rows come from `sessionById` / `scheduleForSession`, so each slice keeps a
 * single owner and no hook can be left unwired.
 */
export class ChatStore {
  private readonly client: RpcClient
  private readonly sessions: SessionStore
  readonly state: ChatStateSlice

  constructor(client: RpcClient, connection: ConnectionStore, sessions: SessionStore) {
    this.state = createChatState()
    this.client = client
    this.sessions = sessions
    connection.on(RpcEvent.sessionStatus, (p) => this.handleStatus(p))
    connection.on(RpcEvent.sessionDelta, (p) => this.handleDelta(p))
    connection.on(RpcEvent.sessionToolStart, (p) => this.handleToolStart(p))
    connection.on(RpcEvent.sessionToolUpdate, (p) => this.handleToolUpdate(p))
    connection.on(RpcEvent.sessionToolEnd, (p) => this.handleToolEnd(p))
    connection.on(RpcEvent.sessionMessageEnd, (p) => this.handleMessageEnd(p))
    connection.on(RpcEvent.sessionRunEnd, (p) => this.handleRunEnd(p))
    connection.on(RpcEvent.sessionTitleUpdated, (p) => this.handleTitleUpdated(p))
  }

  private ensureStreaming(sessionId: string) {
    let st = this.state.streaming[sessionId]
    if (!st) {
      st = emptyStreaming()
      this.state.streaming[sessionId] = st
    }
    return st
  }

  /**
   * Pure read of a session's streaming state. Never mutates state here —
   * this getter runs inside computeds/templates, so writing would be a
   * mutation-during-render anti-pattern. Entries are created eagerly by
   * `sendMessage` and the notification handlers; absent entries read as a
   * stable idle snapshot.
   */
  streamingFor(sessionId: string) {
    return this.state.streaming[sessionId] ?? emptyStreaming()
  }

  /** Drop all per-session chat state (deleted sessions, removed workspaces). */
  evictSession(sessionId: string): void {
    delete this.state.streaming[sessionId]
    delete this.state.lastUsage[sessionId]
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const st = this.ensureStreaming(sessionId)
    st.pendingSend = text
    try {
      await this.client.call(RpcMethod.chatSend, { sessionId, text })
    } catch (err) {
      st.pendingSend = null
      st.status = "error"
      st.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  async steer(sessionId: string, text: string): Promise<void> {
    await this.client.call(RpcMethod.chatSteer, { sessionId, text })
  }

  async followUp(sessionId: string, text: string): Promise<void> {
    await this.client.call(RpcMethod.chatFollowUp, { sessionId, text })
  }

  async abort(sessionId: string): Promise<void> {
    await this.client.call(RpcMethod.chatAbort, { sessionId })
  }

  // ---- notification handlers ----

  private handleStatus(p: RpcNotifications["session.status"]): void {
    const { sessionId, status, error } = p
    const st = this.ensureStreaming(sessionId)
    st.status = status
    st.error = error
    if (status === "running") {
      // New turn: reset buffers (idempotent across re-settles).
      st.textBuf = ""
      st.thinkingBuf = ""
      st.parts = []
      st.activeTool = null
    }
    // Reflect the status locally right away (no RPC); the persisted row only
    // changes at settle, so a real refetch happens there (see run_end).
    const local = this.sessions.sessionById(sessionId)
    if (local) {
      local.status = status
    }
    if (status !== "running") {
      this.sessions.scheduleForSession(sessionId)
    }
  }

  private handleDelta(p: RpcNotifications["session.delta"]): void {
    const { sessionId, kind, delta } = p
    const st = this.ensureStreaming(sessionId)
    if (kind === "text") st.textBuf += delta
    else st.thinkingBuf += delta
  }

  private handleToolStart(p: RpcNotifications["session.tool_start"]): void {
    const { sessionId, toolCallId, toolName, args } = p
    const st = this.ensureStreaming(sessionId)
    // A tool boundary ends the current assistant message: freeze its streamed
    // content so multi-assistant turns render as separate segments instead of
    // one concatenated blob.
    if (st.textBuf || st.thinkingBuf) {
      st.parts.push({ text: st.textBuf, thinking: st.thinkingBuf })
      st.textBuf = ""
      st.thinkingBuf = ""
    }
    st.activeTool = { toolCallId, toolName, args }
  }

  private handleToolUpdate(p: RpcNotifications["session.tool_update"]): void {
    const { sessionId, toolCallId, partialResult } = p
    const st = this.state.streaming[sessionId]
    if (st?.activeTool && st.activeTool.toolCallId === toolCallId) {
      st.activeTool.partialResult = partialResult
    }
  }

  private handleToolEnd(p: RpcNotifications["session.tool_end"]): void {
    const { sessionId, toolCallId, result, isError } = p
    const st = this.state.streaming[sessionId]
    if (st?.activeTool && st.activeTool.toolCallId === toolCallId) {
      st.activeTool.result = result
      st.activeTool.isError = isError
    }
  }

  private handleMessageEnd(p: RpcNotifications["session.message_end"]): void {
    const { sessionId, message } = p
    // The persisted assistant message supersedes the streaming placeholder.
    this.sessions.upsertMessage(sessionId, message)
    const st = this.state.streaming[sessionId]
    if (message.role === "assistant" && st) {
      st.textBuf = ""
      st.thinkingBuf = ""
    }
  }

  private handleRunEnd(p: RpcNotifications["session.run_end"]): void {
    const { sessionId, messages, usage, error } = p
    // Reconcile by stable id: makes message_end + run_end idempotent and
    // supersedes any optimistic/pending UI state.
    this.sessions.reconcileMessages(sessionId, messages)

    // A re-settle of an already-persisted run pushes all-zero usage; don't let
    // it clobber the last real run's numbers.
    if (usage.totalTokens > 0 || this.state.lastUsage[sessionId] === undefined) {
      this.state.lastUsage[sessionId] = usage
    }
    const st = this.ensureStreaming(sessionId)
    st.pendingSend = null
    st.textBuf = ""
    st.thinkingBuf = ""
    st.parts = []
    st.activeTool = null
    st.error = error
    this.sessions.scheduleForSession(sessionId)
  }

  /** LLM auto-title landed: patch the row in place (no refetch needed). */
  private handleTitleUpdated(
    p: RpcNotifications["session.title_updated"],
  ): void {
    const { sessionId, title, updatedAt } = p
    const row = this.sessions.sessionById(sessionId)
    if (row) {
      row.title = title
      // Keep recency in sync with the server (updateTitle bumps updated_at).
      if (updatedAt) row.updatedAt = updatedAt
    }
  }
}
