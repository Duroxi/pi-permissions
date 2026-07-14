/**
 * Safe system device paths that should never trigger external-directory checks.
 */
export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/**
 * Returns true if the given normalized path is a safe OS device file
 * that should never trigger external-directory checks.
 *
 * On Windows, `/dev/null` resolves to a drive-prefixed path like `C:\dev\null`.
 * We also check the lowercased path against Windows-style device suffixes.
 */
export function isSafeSystemPath(normalizedPath: string): boolean {
  if (SAFE_SYSTEM_PATHS.has(normalizedPath)) return true;

  // Windows: check for drive-letter-prefixed forms like c:\dev\null
  if (process.platform === "win32") {
    const lower = normalizedPath.toLowerCase();
    for (const unixPath of SAFE_SYSTEM_PATHS) {
      const winTail = unixPath.replace(/\//g, "\\");
      if (lower.endsWith(winTail)) {
        return true;
      }
    }
  }

  return false;
}
