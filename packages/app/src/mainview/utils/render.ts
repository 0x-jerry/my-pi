import type { StoredMessage } from "@my-pi/shared"

/**
 * Duck-typed renderer for the opaque `StoredMessage.data` blob (serialized pi
 * AgentMessage). The app must not import pi at runtime, so we defensively read
 * the known shape: roles user | assistant | toolResult and content blocks
 * text | thinking | image | toolCall.
 */

export type RenderedBlock =
  | { role: "user" | "assistant" | "toolResult"; kind: "text"; text: string }
  | { role: "assistant"; kind: "thinking"; text: string; redacted?: boolean }
  | { role: "user" | "toolResult"; kind: "image"; mimeType: string; data: string }
  | { role: "assistant"; kind: "toolCall"; toolCallId: string; toolName: string; args: unknown }
  | { role: "toolResult"; kind: "toolResult"; toolName: string; isError: boolean; text: string }

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function blockText(v: unknown): string {
  const r = asRecord(v)
  return r && typeof r.text === "string" ? r.text : ""
}

/** Render one persisted message into display blocks (never throws). */
export function renderStoredMessage(msg: StoredMessage): RenderedBlock[] {
  const data = asRecord(msg.data)
  if (!data) return []
  const content = data.content
  const role = msg.role === "assistant" || msg.role === "toolResult" ? msg.role : "user"

  if (role === "assistant") {
    const blocks: RenderedBlock[] = []
    if (Array.isArray(content)) {
      for (const raw of content) {
        const b = asRecord(raw)
        if (!b) continue
        if (b.type === "text") {
          const text = typeof b.text === "string" ? b.text : ""
          if (text) blocks.push({ role, kind: "text", text })
        } else if (b.type === "thinking") {
          const text = typeof b.thinking === "string" ? b.thinking : ""
          if (text)
            blocks.push({
              role,
              kind: "thinking",
              text,
              redacted: b.redacted === true,
            })
        } else if (b.type === "toolCall") {
          blocks.push({
            role,
            kind: "toolCall",
            toolCallId: typeof b.id === "string" ? b.id : "",
            toolName: typeof b.name === "string" ? b.name : "tool",
            args: b.arguments,
          })
        }
      }
    }
    return blocks
  }

  if (role === "toolResult") {
    const toolName = typeof data.toolName === "string" ? data.toolName : "tool"
    const isError = data.isError === true
    const texts: string[] = []
    const blocks: RenderedBlock[] = []
    if (typeof content === "string") texts.push(content)
    else if (Array.isArray(content)) {
      for (const raw of content) {
        const b = asRecord(raw)
        if (!b) continue
        if (b.type === "text") {
          texts.push(blockText(b))
        } else if (b.type === "image") {
          const mimeType = typeof b.mimeType === "string" ? b.mimeType : "image/png"
          const dataStr = typeof b.data === "string" ? b.data : ""
          if (dataStr) blocks.push({ role, kind: "image", mimeType, data: dataStr })
        }
      }
    }
    return [
      {
        role,
        kind: "toolResult",
        toolName,
        isError,
        text: texts.join("\n"),
      },
      ...blocks,
    ]
  }

  // user
  const blocks: RenderedBlock[] = []
  if (typeof content === "string") {
    if (content) blocks.push({ role, kind: "text", text: content })
  } else if (Array.isArray(content)) {
    for (const raw of content) {
      const b = asRecord(raw)
      if (!b) continue
      if (b.type === "text") {
        const text = blockText(b)
        if (text) blocks.push({ role, kind: "text", text })
      } else if (b.type === "image") {
        const mimeType = typeof b.mimeType === "string" ? b.mimeType : "image/png"
        const dataStr = typeof b.data === "string" ? b.data : ""
        if (dataStr) blocks.push({ role, kind: "image", mimeType, data: dataStr })
      }
    }
  }
  return blocks
}

/** True when a persisted assistant message carries an error. */
export function messageError(msg: StoredMessage): string | undefined {
  const data = asRecord(msg.data)
  if (!data) return undefined
  if (typeof data.errorMessage === "string" && data.errorMessage) {
    return data.errorMessage
  }
  return data.stopReason === "error" ? "Agent run failed" : undefined
}
