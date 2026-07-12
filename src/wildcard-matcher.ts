import { expandHomePath } from "./expand-home";

/**
 * Maximum allowed length for a wildcard pattern.
 * Patterns exceeding this limit are rejected as never-matching to prevent
 * ReDoS attacks via adversarial inputs (e.g., extremely long patterns with
 * nested quantifiers). Ported from MasuRii/pi-permission-system.
 */
export const MAX_WILDCARD_PATTERN_LENGTH = 500;

/**
 * A regex that never matches any input, including the empty string.
 * Uses an impossible character class: a character that is neither whitespace
 * nor non-whitespace cannot exist. Used as a safe fallback when a wildcard
 * pattern exceeds MAX_WILDCARD_PATTERN_LENGTH.
 */
const NEVER_MATCH_PATTERN: RegExp = /[^\s\S]/;

export type CompiledWildcardPattern<TState> = {
  pattern: string;
  state: TState;
  regex: RegExp;
};

export type WildcardPatternMatch<TState> = {
  state: TState;
  matchedPattern: string;
  matchedName: string;
};

/**
 * Optional folding applied when matching path-surface patterns on Windows.
 *
 * - `caseInsensitive` compiles the pattern with the `i` flag so a mixed-case
 *   pattern matches a lowercased (canonicalized) path value.
 * - `windowsSeparators` rewrites `/` to `\` in the expanded pattern so a
 *   forward-slash pattern matches a backslash-separated path value.
 */
export interface WildcardMatchOptions {
  caseInsensitive?: boolean;
  windowsSeparators?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileWildcardPattern<TState>(
  pattern: string,
  state: TState,
  options?: WildcardMatchOptions,
): CompiledWildcardPattern<TState> {
  // Expand ~ and $HOME prefixes BEFORE length check to prevent bypass:
  // a short pattern like "~/..." (495 chars) can expand to a 555+ char path.
  const expanded = expandHomePath(pattern);

  // ReDoS protection: reject patterns exceeding the safe length limit.
  // Check is performed after ~/$HOME expansion to prevent bypass via
  // short patterns that expand to long paths.
  if (expanded.length > MAX_WILDCARD_PATTERN_LENGTH) {
    return {
      pattern,
      state,
      regex: NEVER_MATCH_PATTERN,
    };
  }

  const normalized = options?.windowsSeparators
    ? expanded.replaceAll("/", "\\")
    : expanded;
  let escaped = normalized
    .split("*")
    .map((part) => escapeRegExp(part).replaceAll("\\?", "."))
    .join(".*");

  // If the pattern ends with " *" (space + wildcard), make the trailing
  // space-and-arguments portion optional so that e.g. "git *" matches both
  // "git status" and bare "git". Mirrors OpenCode wildcard semantics.
  if (escaped.endsWith(" .*")) {
    escaped = `${escaped.slice(0, -3)}( .*)?`;
  }

  return {
    pattern,
    state,
    regex: new RegExp(`^${escaped}$`, options?.caseInsensitive ? "si" : "s"),
  };
}

export function compileWildcardPatternEntries<TState>(
  entries: Iterable<readonly [string, TState]>,
): CompiledWildcardPattern<TState>[] {
  return Array.from(entries, ([pattern, state]) =>
    compileWildcardPattern(pattern, state),
  );
}

function _compileWildcardPatterns<TState>(
  patterns: Record<string, TState>,
): CompiledWildcardPattern<TState>[] {
  return compileWildcardPatternEntries(Object.entries(patterns));
}

export function findCompiledWildcardMatch<TState>(
  patterns: readonly CompiledWildcardPattern<TState>[],
  name: string,
): WildcardPatternMatch<TState> | null {
  const match = patterns.findLast((p) => p.regex.test(name));
  if (match === undefined) return null;
  return {
    state: match.state,
    matchedPattern: match.pattern,
    matchedName: name,
  };
}

/**
 * Test whether `value` matches `pattern` using wildcard rules.
 * `*` matches any sequence of characters (including empty).
 * `?` matches exactly one character.
 * Used by evaluate() for rule matching.
 */
export function wildcardMatch(
  pattern: string,
  value: string,
  options?: WildcardMatchOptions,
): boolean {
  return compileWildcardPattern(pattern, null, options).regex.test(value);
}

export function findCompiledWildcardMatchForNames<TState>(
  patterns: readonly CompiledWildcardPattern<TState>[],
  names: readonly string[],
): WildcardPatternMatch<TState> | null {
  const normalizedNames = names
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (normalizedNames.length === 0) {
    return null;
  }

  for (const name of normalizedNames) {
    const match = findCompiledWildcardMatch(patterns, name);
    if (match) {
      return match;
    }
  }

  return null;
}
