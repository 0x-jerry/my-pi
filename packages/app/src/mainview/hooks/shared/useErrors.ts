import { ElMessage } from "element-plus"

/** Present an error to the user via a toast. */
export function showError(err: unknown): void {
  ElMessage.error(err instanceof Error ? err.message : String(err))
}

/** Normalize an unknown thrown value into a displayable message. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
