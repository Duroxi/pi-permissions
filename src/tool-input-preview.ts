import { safeJsonStringify } from "./logging";

export const TOOL_INPUT_PREVIEW_MAX_LENGTH = 200;
export const TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH = 1000;
export const TOOL_TEXT_SUMMARY_MAX_LENGTH = 80;

export function truncateInlineText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/** Normalize whitespace, trim, and truncate for inline display. */
export function sanitizeInlineText(
  value: string,
  maxLength = TOOL_TEXT_SUMMARY_MAX_LENGTH,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? truncateInlineText(normalized, maxLength) : "empty text";
}

export function countTextLines(value: string): number {
  if (!value) {
    return 0;
  }

  return value.split(/\r\n|\r|\n/).length;
}

export function formatCount(
  value: number,
  singular: string,
  plural: string,
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function serializeToolInputPreview(input: unknown): string {
  const serialized = safeJsonStringify(input);
  if (!serialized || serialized === "{}" || serialized === "null") {
    return "";
  }

  return serialized.replace(/\s+/g, " ").trim();
}
