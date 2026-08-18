/**
 * Shared domain types for the store split. Kept in their own module so both
 * the domain stores and the root facade can import them without cycles.
 */

export interface ActiveToolState {
  toolCallId: string
  toolName: string
  args: unknown
  partialResult?: unknown
  result?: unknown
  isError?: boolean
}

/**
 * A local-only placeholder session shown in the tree after clicking "+".
 * No server row exists until the first message is sent (see sendDraft).
 */
export interface DraftSession {
  localId: string
  workspaceId: string
}

/** A completed streamed segment (frozen at a tool boundary mid-run). */
export interface StreamedPart {
  text: string
  thinking: string
}

export interface StreamingState {
  status: "idle" | "running" | "stopped" | "error"
  error?: string
  textBuf: string
  thinkingBuf: string
  /** Completed assistant segments from earlier in the current run. */
  parts: StreamedPart[]
  activeTool: ActiveToolState | null
  /** The user prompt just sent; rendered optimistically until run_end. */
  pendingSend: string | null
}

export function emptyStreaming(): StreamingState {
  return {
    status: "idle",
    textBuf: "",
    thinkingBuf: "",
    parts: [],
    activeTool: null,
    pendingSend: null,
  }
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
