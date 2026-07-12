import type { PermissionSystemExtensionConfig } from "./extension-config";
import type { PermissionState } from "./types";

export interface AskPermissionResolutionOptions {
  config: PermissionSystemExtensionConfig;
  hasUI: boolean;
  isSubagent: boolean;
}

/**
 * Check if yolo mode is effectively enabled.
 * Supports both new `mode: "yolo"` and deprecated `yoloMode: true`.
 */
export function isYoloModeEnabled(
  config: PermissionSystemExtensionConfig,
): boolean {
  return config.mode === "yolo" || config.yoloMode === true;
}

export function shouldAutoApprovePermissionState(
  state: PermissionState,
  config: PermissionSystemExtensionConfig,
): boolean {
  return state === "ask" && isYoloModeEnabled(config);
}

export function canResolveAskPermissionRequest(
  options: AskPermissionResolutionOptions,
): boolean {
  return (
    options.hasUI || options.isSubagent || isYoloModeEnabled(options.config)
  );
}
