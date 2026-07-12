import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { UnifiedPermissionConfig } from "./config-loader";

export const EXTENSION_ID = "pi-permission-system";

/**
 * Permission mode controlling auto-approval behavior.
 * Ported from pi-quick-perms.
 *
 * - "default": All ask-state checks require user confirmation
 * - "allowEdits": Auto-approve write/edit for in-CWD paths; prompt for everything else
 * - "yolo": Auto-approve all ask-state checks (original yoloMode behavior)
 */
export type PermissionMode = "default" | "allowEdits" | "yolo";

const VALID_MODES = new Set<string>(["default", "allowEdits", "yolo"]);

export interface PermissionSystemExtensionConfig {
  debugLog: boolean;
  permissionReviewLog: boolean;
  /** Permission mode: "default" | "allowEdits" | "yolo". Replaces boolean yoloMode. */
  mode: PermissionMode;
  /** @deprecated Use mode: "yolo" instead. Kept for backward compatibility reading. */
  yoloMode?: boolean;
  /** Additional directories to auto-allow for reads as Pi infrastructure. */
  piInfrastructureReadPaths?: string[];
  /** Max length of the inline-JSON input preview shown in permission prompts. Defaults to 200. */
  toolInputPreviewMaxLength?: number;
  /** Max length of inline pattern/path summaries (grep/find/ls) in permission prompts. Defaults to 80. */
  toolTextSummaryMaxLength?: number;
  /**
   * Timeout in seconds for forwarded permission prompts shown to the parent session.
   * When the timeout expires, the request is automatically denied (fail-safe).
   * Set to null to disable timeout (default behavior). Defaults to 30 seconds.
   * Ported from MasuRii/pi-permission-system.
   */
  forwardedPromptTimeoutSeconds?: number | null;
}

export const DEFAULT_EXTENSION_CONFIG: PermissionSystemExtensionConfig = {
  debugLog: false,
  permissionReviewLog: true,
  mode: "default",
  forwardedPromptTimeoutSeconds: 30,
};

/**
 * Resolve the effective mode from a raw config record.
 * Handles backward compatibility: yoloMode: true → "yolo".
 * Ported from pi-quick-perms.
 */
export function resolveModeFromRecord(record: Record<string, unknown>): PermissionMode {
  if (typeof record.mode === "string" && VALID_MODES.has(record.mode)) {
    return record.mode as PermissionMode;
  }
  // Backward compat: deprecated yoloMode boolean
  if (record.yoloMode === true) return "yolo";
  return "default";
}

function resolveExtensionRoot(moduleUrl = import.meta.url): string {
  return join(dirname(fileURLToPath(moduleUrl)), "..");
}

export const EXTENSION_ROOT = resolveExtensionRoot();

const PERMISSION_POLICY_KEYS: ReadonlySet<string> = new Set([
  "defaultPolicy",
  "tools",
  "bash",
  "mcp",
  "skills",
  "special",
  "external_directory",
]);

export function detectMisplacedPermissionKeys(
  raw: Record<string, unknown>,
): string[] {
  return Object.keys(raw).filter((key) => PERMISSION_POLICY_KEYS.has(key));
}

export function normalizePermissionSystemConfig(
  raw: UnifiedPermissionConfig,
): PermissionSystemExtensionConfig {
  const mode = resolveModeFromRecord(raw as Record<string, unknown>);
  const result: PermissionSystemExtensionConfig = {
    debugLog: raw.debugLog === true,
    permissionReviewLog: raw.permissionReviewLog !== false,
    mode,
    forwardedPromptTimeoutSeconds: DEFAULT_EXTENSION_CONFIG.forwardedPromptTimeoutSeconds,
  };
  if (raw.piInfrastructureReadPaths !== undefined) {
    result.piInfrastructureReadPaths = raw.piInfrastructureReadPaths;
  }
  if (raw.toolInputPreviewMaxLength !== undefined) {
    result.toolInputPreviewMaxLength = raw.toolInputPreviewMaxLength;
  }
  if (raw.toolTextSummaryMaxLength !== undefined) {
    result.toolTextSummaryMaxLength = raw.toolTextSummaryMaxLength;
  }
  if (raw.forwardedPromptTimeoutSeconds !== undefined) {
    result.forwardedPromptTimeoutSeconds = raw.forwardedPromptTimeoutSeconds;
  }
  return result;
}

export function ensurePermissionSystemLogsDirectory(
  logsDir: string,
): string | undefined {
  try {
    mkdirSync(logsDir, { recursive: true });
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Failed to create permission-system log directory '${logsDir}': ${message}`;
  }
}
