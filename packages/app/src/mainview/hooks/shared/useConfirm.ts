import { ElMessageBox } from "element-plus"

export interface ConfirmOptions {
  message: string
  title: string
  confirmButtonText?: string
  cancelButtonText?: string
  type?: "warning" | "info" | "success" | "error"
}

/**
 * Show a confirmation dialog. Resolves `true` if the user confirms, `false`
 * if they dismiss (cancel / close / escape) — never throws on dismissal.
 */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  try {
    await ElMessageBox.confirm(options.message, options.title, {
      type: options.type ?? "warning",
      confirmButtonText: options.confirmButtonText ?? "Confirm",
      cancelButtonText: options.cancelButtonText ?? "Cancel",
    })
    return true
  } catch {
    return false // dismissed
  }
}
