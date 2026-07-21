import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, normalize } from "node:path";
import type {
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import { loadAndMergeConfigs, loadUnifiedConfig } from "./config-loader";
import {
  getGlobalConfigPath,
  getLegacyExtensionConfigPath,
  getLegacyGlobalPolicyPath,
  getLegacyProjectPolicyPath,
} from "./config-paths";
import { buildResolvedConfigLogEntry } from "./config-reporter";
import {
  DEFAULT_EXTENSION_CONFIG,
  EXTENSION_ROOT,
  normalizePermissionSystemConfig,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import type { ResolvedPolicyPaths } from "./policy-loader";
import type { DebugReviewLogger } from "./session-logger";
import { syncPermissionSystemStatus } from "./status";

/** Read-only view of the current config — for consumers that only read. */
export interface ConfigReader {
  current(): PermissionSystemExtensionConfig;
}

/**
 * Narrow subset of `ConfigStore` that `PermissionSession` depends on.
 *
 * Using an interface rather than the concrete class avoids private-member
 * coupling between the class and test doubles.
 */
export interface SessionConfigStore extends ConfigReader {
  refresh(ctx?: ExtensionContext): void;
  logResolvedPaths(cwd?: string): void;
}

/**
 * Narrow subset of `ConfigStore` for the `/permission-system` command.
 *
 * Using an interface rather than the concrete class avoids private-member
 * coupling between the class and test doubles.
 */
export interface CommandConfigStore extends ConfigReader {
  save(
    next: PermissionSystemExtensionConfig,
    ctx: { ui: ExtensionUIContext },
  ): void;
}

/** Narrow view of the manager's resolved policy paths (for `logResolvedPaths`). */
export interface ResolvedPolicyPathProvider {
  getResolvedPolicyPaths(): ResolvedPolicyPaths;
}

export interface ConfigStoreDeps {
  agentDir: string;
  policyPaths: ResolvedPolicyPathProvider;
  logger: DebugReviewLogger;
}

/**
 * Owns the mutable extension config and the operations that read/write it.
 *
 * Replaces the three `(runtime, …)` config free functions
 * (`refreshExtensionConfig`, `saveExtensionConfig`, `logResolvedConfigPaths`)
 * with methods that privately own `config` and `lastConfigWarning`.
 *
 * Implements {@link ConfigReader} so consumers that only read the current config
 * can depend on the narrow interface rather than the full class.
 */
export class ConfigStore implements SessionConfigStore, CommandConfigStore {
  private config: PermissionSystemExtensionConfig;
  private lastConfigWarning: string | null = null;

  constructor(private readonly deps: ConfigStoreDeps) {
    this.config = { ...DEFAULT_EXTENSION_CONFIG };
  }

  /** Return the current extension config. */
  current(): PermissionSystemExtensionConfig {
    return this.config;
  }

  /**
   * Reload merged config from disk.
   *
   * If `ctx` is provided, uses it to derive the cwd and sync UI status.
   * Equivalent to `refreshExtensionConfig(runtime, ctx?)`.
   */
  refresh(ctx?: ExtensionContext): void {
    const cwd = ctx?.cwd ?? null;
    const mergeResult = loadAndMergeConfigs(
      this.deps.agentDir,
      cwd ?? "",
      EXTENSION_ROOT,
    );
    const runtimeConfig = normalizePermissionSystemConfig(mergeResult.merged);
    this.config = runtimeConfig;

    if (ctx?.hasUI) {
      syncPermissionSystemStatus(ctx, runtimeConfig);
    }

    const warning =
      mergeResult.issues.length > 0 ? mergeResult.issues.join("\n") : undefined;

    if (warning) {
      // Use the first line as the dedup key — the issue type is consistent
      // even when absolute paths differ between runs or machines.
      const warningKey = warning.split("\n")[0];
      if (warningKey !== this.lastConfigWarning) {
        this.lastConfigWarning = warningKey;
        ctx?.ui.notify(warning, "warning");
      }
    } else {
      this.lastConfigWarning = null;
    }

    this.deps.logger.debug("config.loaded", {
      warning: warning ?? null,
      debugLog: runtimeConfig.debugLog,
      permissionReviewLog: runtimeConfig.permissionReviewLog,
      mode: runtimeConfig.mode,
    });
  }

  /**
   * Save updated runtime knobs to the global config file, then update
   * the current config and sync UI status.
   *
   * Equivalent to `saveExtensionConfig(runtime, next, ctx)`.
   */
  // Called via the CommandConfigStore interface from config-modal.ts — fallow cannot trace through interfaces.
  // fallow-ignore-next-line unused-class-member
  save(
    next: PermissionSystemExtensionConfig,
    ctx: { ui: ExtensionUIContext },
  ): void {
    const normalized = normalizePermissionSystemConfig(next);
    const globalPath = getGlobalConfigPath(this.deps.agentDir);

    const existing = loadUnifiedConfig(globalPath);
    // Only override frontend-editable fields; preserve all other settings
    // (forwardedPromptTimeoutSeconds, toolInputPreviewMaxLength, etc.)
    // that were set directly in the config file by the user.
    const merged = {
      ...existing.config,
      debugLog: normalized.debugLog,
      permissionReviewLog: normalized.permissionReviewLog,
      mode: normalized.mode,
    };

    const tmpPath = `${globalPath}.tmp`;
    try {
      mkdirSync(dirname(globalPath), { recursive: true });
      writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
      renameSync(tmpPath, globalPath);
    } catch (error) {
      // Clean up temp file on failure.
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup failures.
      }
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `Failed to save permission-system config at '${globalPath}': ${message}`,
        "error",
      );
      return;
    }

    this.config = normalized;
    syncPermissionSystemStatus(ctx, normalized);
    this.lastConfigWarning = null;

    this.deps.logger.debug("config.saved", {
      debugLog: normalized.debugLog,
      permissionReviewLog: normalized.permissionReviewLog,
      mode: normalized.mode,
    });
  }

  /**
   * Write the resolved config path set to the review and debug logs.
   *
   * Equivalent to `logResolvedConfigPaths(runtime)`.
   */
  logResolvedPaths(cwd?: string): void {
    const policyPaths = this.deps.policyPaths.getResolvedPolicyPaths();
    const { agentDir } = this.deps;
    const legacyGlobalPolicyDetected = existsSync(
      getLegacyGlobalPolicyPath(agentDir),
    );
    const legacyProjectPolicyDetected = cwd
      ? existsSync(getLegacyProjectPolicyPath(cwd))
      : false;
    const legacyExtConfigPath = getLegacyExtensionConfigPath(EXTENSION_ROOT);
    const newGlobalPath = getGlobalConfigPath(agentDir);
    const legacyExtensionConfigDetected =
      normalize(legacyExtConfigPath) !== normalize(newGlobalPath) &&
      existsSync(legacyExtConfigPath);
    const entry = buildResolvedConfigLogEntry({
      policyPaths,
      legacyGlobalPolicyDetected,
      legacyProjectPolicyDetected,
      legacyExtensionConfigDetected,
    });
    this.deps.logger.review(
      "config.resolved",
      entry as unknown as Record<string, unknown>,
    );
    this.deps.logger.debug(
      "config.resolved",
      entry as unknown as Record<string, unknown>,
    );
  }
}
