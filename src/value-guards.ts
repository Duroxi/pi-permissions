import type { DenyWithReason, PermissionState } from "./types";

export function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Returns `raw` if it is an array of strings; otherwise `undefined`. */
export function normalizeOptionalStringArray(
  raw: unknown,
): string[] | undefined {
  return Array.isArray(raw) &&
    raw.every((p): p is string => typeof p === "string")
    ? raw
    : undefined;
}

/** Returns `raw` if it is a positive integer; otherwise `undefined`. */
export function normalizeOptionalPositiveInt(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0
    ? raw
    : undefined;
}

/**
 * Normlize a raw config value that may be a positive integer or null.
 * null means "disable timeout". Positive integer means "N seconds".
 * Returns undefined when the value is absent or invalid (e.g. 0, negative, non-integer).
 */
export function normalizeOptionalNullablePositiveInt(
  raw: unknown,
): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  return undefined;
}

export function isPermissionState(value: unknown): value is PermissionState {
  return value === "allow" || value === "deny" || value === "ask";
}

/**
 * Narrow type guard: a raw value representing a DenyWithReason object.
 * Accepts `{ action: "deny" }` and `{ action: "deny", reason: "…" }`.
 * Rejects a non-string `reason` to keep malformed config out of the rule set.
 */
export function isDenyWithReason(value: unknown): value is DenyWithReason {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.action === "deny" &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}

/**
 * Sanitize an agent name for safe filesystem use.
 * Rejects path traversal characters (/, , ..) and trims whitespace.
 * Returns the sanitized name, or null if the name is empty or contains
 * path traversal patterns.
 */
export function sanitizeAgentName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed;
}
