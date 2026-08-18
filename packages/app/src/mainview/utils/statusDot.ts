import type { SessionInfo } from "@my-pi/shared"

/** CSS class for a session's status dot. */
export function statusDot(s: SessionInfo): string {
  switch (s.status) {
    case "running":
      return "dot-running"
    case "error":
      return "dot-error"
    default:
      return "dot-idle"
  }
}
