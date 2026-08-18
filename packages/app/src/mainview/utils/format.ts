import type { SessionInfo, UsageSummary } from "@my-pi/shared"

/** Token + cost rollup line for a session list entry. */
export function fmtSessionTokens(s: SessionInfo): string {
  const total =
    s.totalInputTokens +
    s.totalOutputTokens +
    s.totalCacheRead +
    s.totalCacheWrite
  return `${total.toLocaleString()} tok · $${s.totalCost.toFixed(4)}`
}

/** Last-run usage line for the chat footer. */
export function fmtUsage(
  u: Pick<UsageSummary, "input" | "output" | "cacheRead" | "cacheWrite" | "cost">,
): string {
  return `in ${u.input} · out ${u.output} · cache ${u.cacheRead + u.cacheWrite} · $${u.cost.toFixed(4)}`
}

/** Compact per-message usage line (total tokens + cost). */
export function fmtMsgUsage(
  u: Pick<UsageSummary, "totalTokens" | "cost">,
): string {
  return `${u.totalTokens.toLocaleString()} tok · $${u.cost.toFixed(4)}`
}

/** Pretty-print tool call arguments (never throws). */
export function jsonArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}
