import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { PermissionState } from "./types";

/**
 * Surfaces that allow-edits mode auto-approves when state is ask.
 * Only write and edit operations on in-CWD paths are auto-approved.
 * Bash, MCP, skills, external paths, and other surfaces still require confirmation.
 * Ported from pi-quick-perms.
 */
const AUTO_APPROVE_SURFACES = new Set(["write", "edit"]);

/**
 * Check if allowEdits mode is effectively enabled.
 * Ported from pi-quick-perms.
 */
export function isAllowEditsModeEnabled(
  config: PermissionSystemExtensionConfig,
): boolean {
  return config.mode === "allowEdits";
}

/**
 * Returns true when the current tool + state should be auto-approved
 * under allow-edits mode.
 *
 * Only applies when:
 *   - allowEdits mode is enabled
 *   - state is exactly "ask"
 *   - surface is a recognized surface (write / edit)
 *   - the path is NOT an external path (outside CWD)
 *
 * Ported from pi-quick-perms.
 */
export function shouldAutoApproveForAllowEdits(
  surface: string | undefined,
  state: PermissionState,
  config: PermissionSystemExtensionConfig,
  isExternalPath: boolean = false,
): boolean {
  if (!isAllowEditsModeEnabled(config)) return false;
  if (state !== "ask") return false;
  if (!surface) return false;
  if (isExternalPath) return false;
  const normalized = surface.trim().toLowerCase();
  return AUTO_APPROVE_SURFACES.has(normalized);
}
