import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the effective home directory, checking the `$HOME` environment
 * variable first before falling back to the OS user directory.
 *
 * In Docker, CI, or `sudo` contexts `process.env.HOME` may differ from
 * `os.homedir()`. Reading the env var first gives users a way to override
 * the home directory via the environment.
 */
function resolveHomeDir(): string {
  if (typeof process.env.HOME === "string" && process.env.HOME.length > 0) {
    return process.env.HOME;
  }
  return homedir();
}

/**
 * Expand `~` and `$HOME` prefixes in a pattern to the home directory.
 *
 * Resolution priority: `process.env.HOME` > `os.homedir()`.
 *
 * Supported forms:
 * - `~`          → `resolveHomeDir()`
 * - `~/path`     → `resolveHomeDir()/path`
 * - `~\path`     → `resolveHomeDir()\path` (Windows)
 * - `$HOME`      → `resolveHomeDir()`
 * - `$HOME/path` → `resolveHomeDir()/path`
 * - `$HOME\path` → `resolveHomeDir()\path` (Windows)
 *
 * All other patterns (including `~user` which POSIX supports but we
 * deliberately do not support — Pi extensions run as the Pi user, not an
 * arbitrary user) are returned unchanged.
 */
export function expandHomePath(pattern: string): string {
  const home = resolveHomeDir();
  if (pattern === "~" || pattern === "$HOME") {
    return home;
  }
  if (pattern.startsWith("~/") || pattern.startsWith("~\\")) {
    return join(home, pattern.slice(2));
  }
  if (pattern.startsWith("$HOME/") || pattern.startsWith("$HOME\\")) {
    return join(home, pattern.slice(6));
  }
  return pattern;
}
