import {
  RpcEvent,
  RpcMethod,
  type RpcNotifications,
  type SessionInfo,
} from "@my-pi/shared"
import type { ConnectionStore } from "./connectionStore"
import type { AppState } from "./state"
import type { RpcClient } from "../rpc/client"
import { emptyStreaming } from "./types"

/**
 * Chat domain: per-session streaming state, the send / steer / follow-up /
 * abort actions, and the live notification handlers (status/delta/tool/message/
 * run/title) that mutate the shared state.
 */
export class ChatStore {
  private readonly client: RpcClient
  readonly state: AppState

  /**
   * Set by the root facade after all stores exist: refetch the active
   * workspace's sessions when a run settles or status changes.
   */
  sessionsRefresh?: (sessionId: string) => void

  /**
   * Set by the root facade: resolve a session row from any workspace's cache
   * (several tree nodes can be expanded, so the row may not belong to the
   * active workspace). Falls back to the active list when unset.
   */
  sessionLookup?: (sessionId: string) => SessionInfo | null

  constructor(state: AppState, client: RpcClient, connection: ConnectionStore) {
    this.state = state
    this.client = client
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

  streamingFor(sessionId: string) {
    return this.ensureStreaming(sessionId)
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
    const local = this.sessionLookup
      ? this.sessionLookup(sessionId)
      : this.state.sessions.find((s) => s.id === sessionId)
    if (local) {
      local.status = status
    }
    if (status !== "running") {
      this.sessionsRefresh?.(sessionId)
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
    const current = this.state.messagesBySession[sessionId]
    const list = current ?? []
    const idx = list.findIndex((m) => m.id === message.id)
    if (idx >= 0) list[idx] = message
    else list.push(message)
    if (!current) this.state.messagesBySession[sessionId] = list
    // The persisted assistant message supersedes the streaming placeholder.
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
    const current = this.state.messagesBySession[sessionId] ?? []
    const byId = new Map(current.map((m) => [m.id, m]))
    for (const m of messages) byId.set(m.id, m)
    this.state.messagesBySession[sessionId] = [...byId.values()]

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
    this.sessionsRefresh?.(sessionId)
  }

  /** LLM auto-title landed: patch the row in place (no refetch needed). */
  private handleTitleUpdated(
    p: RpcNotifications["session.title_updated"],
  ): void {
    const { sessionId, title, updatedAt } = p
    const row = this.sessionLookup
      ? this.sessionLookup(sessionId)
      : this.state.sessions.find((s) => s.id === sessionId)
    if (row) {
      row.title = title
      // Keep recency in sync with the server (updateTitle bumps updated_at).
      if (updatedAt) row.updatedAt = updatedAt
    }
  }
}
