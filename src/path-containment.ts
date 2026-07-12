import { posix as posixPath, win32 as winPath } from "node:path";

import { isSafeSystemPath } from "./safe-system-paths";

/**
 * Returns true when `pathValue` is `directory` itself or nested inside it.
 *
 * Containment is decided with Node's platform-native `path.relative` rather
 * than a hand-rolled prefix check: on `win32` the comparison folds case (and
 * tolerates either separator), matching the case-insensitive filesystem.
 * `platform` is injected from the composition root so Windows behavior is
 * testable on a POSIX CI.
 */
export function isPathWithinDirectory(
  pathValue: string,
  directory: string,
  platform: NodeJS.Platform,
): boolean {
  if (!pathValue || !directory) {
    return false;
  }

  if (pathValue === directory) {
    return true;
  }

  const impl = platform === "win32" ? winPath : posixPath;
  const rel = impl.relative(directory, pathValue);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${impl.sep}`) &&
    !impl.isAbsolute(rel)
  );
}

/**
 * Pure geometry: is `canonicalPath` outside `canonicalCwd`?
 *
 * Both operands must already be canonical (symlink-resolved, win32-lowercased)
 * — the caller prepares them (see {@link PathNormalizer.isOutsideWorkingDirectory}).
 * This predicate touches no filesystem and does no derivation.
 */
export function isPathOutsideWorkingDirectory(
  canonicalPath: string,
  canonicalCwd: string,
  platform: NodeJS.Platform,
): boolean {
  if (!canonicalCwd || !canonicalPath) {
    return false;
  }
  if (isSafeSystemPath(canonicalPath)) {
    return false;
  }
  return !isPathWithinDirectory(canonicalPath, canonicalCwd, platform);
}
