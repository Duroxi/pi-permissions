/**
 * Safe system device paths that should never trigger external-directory checks.
 */
export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/** Windows drive-letter forms of the safe paths (e.g. `c:\dev\null`). */
const WINDOWS_SAFE_PATHS: ReadonlySet<string> = new Set(
  [...SAFE_SYSTEM_PATHS].map((p) => `c:${p.replace(/\//g, "\\")}`),
);

/**
 * Returns true if the given normalized path is a safe OS device file
 * that should never trigger external-directory checks.
 *
 * On POSIX, checks exact match against `/dev/null`, `/dev/stdin`, etc.
 * On Windows, checks exact match against the lowercased drive-letter form
 * (`c:\dev\null`) — NOT a suffix match, to prevent false positives like
 * `C:\Users\dev\null\secret.json`.
 */
export function isSafeSystemPath(normalizedPath: string): boolean {
  if (SAFE_SYSTEM_PATHS.has(normalizedPath)) return true;

  if (process.platform === "win32") {
    return WINDOWS_SAFE_PATHS.has(normalizedPath.toLowerCase());
  }

  return false;
}
