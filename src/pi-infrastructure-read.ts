import { join } from "node:path";

import { expandHomePath } from "./expand-home";
import { isPathWithinDirectory } from "./path-containment";
import { READ_ONLY_PATH_BEARING_TOOLS } from "./path-surfaces";
import { wildcardMatch } from "./wildcard-matcher";

function containsGlobChars(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

/**
 * Returns true if the given tool + normalized path combination qualifies for
 * automatic allow as a Pi infrastructure read.
 *
 * A path qualifies when:
 * 1. The tool is read-only (in READ_ONLY_PATH_BEARING_TOOLS).
 * 2. The normalized path is within one of the provided `infrastructureDirs`
 *    OR within the project-local Pi package directories
 *    (`<cwd>/.pi/npm/` or `<cwd>/.pi/git/`).
 *
 * `infrastructureDirs` entries may be absolute paths or patterns containing
 * `~`/`$HOME` (expanded at call time) or glob characters (`*`, `?`).
 * Project-local paths are computed fresh from `cwd` on each call so they
 * follow working-directory changes without a runtime rebuild.
 */
export function isPiInfrastructureRead(
  toolName: string,
  normalizedPath: string,
  infrastructureDirs: readonly string[],
  cwd: string,
  platform: NodeJS.Platform,
): boolean {
  if (!READ_ONLY_PATH_BEARING_TOOLS.has(toolName)) {
    return false;
  }

  // On Windows the path value is canonicalized + lowercased; fold case (and
  // separators) so mixed-case infra dirs and glob patterns still match.
  const matchOptions =
    platform === "win32"
      ? { caseInsensitive: true, windowsSeparators: true }
      : undefined;

  for (const dir of infrastructureDirs) {
    if (containsGlobChars(dir)) {
      if (wildcardMatch(dir, normalizedPath, matchOptions)) return true;
    } else {
      if (isPathWithinDirectory(normalizedPath, expandHomePath(dir), platform))
        return true;
    }
  }

  // Project-local Pi packages — checked fresh every call so CWD changes work.
  const projectNpmDir = join(cwd, ".pi", "npm");
  const projectGitDir = join(cwd, ".pi", "git");
  if (isPathWithinDirectory(normalizedPath, projectNpmDir, platform)) {
    return true;
  }
  if (isPathWithinDirectory(normalizedPath, projectGitDir, platform)) {
    return true;
  }

  return false;
}
