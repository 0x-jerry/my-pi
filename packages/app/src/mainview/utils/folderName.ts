/** Last path segment of a folder, e.g. "/home/u/code/x" → "x". */
export function folderName(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "")
  const base = trimmed.split(/[\\/]/).pop()
  return base && base !== trimmed ? base : dir
}
