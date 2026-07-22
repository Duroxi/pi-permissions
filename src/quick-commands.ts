import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { isPermissionState } from "./value-guards";
import type { FlatPermissionConfig, PermissionState } from "./types";

/**
 * Quick permission commands for interactive rule management.
 * Provides /allow, /block, /ask, /policy, /policy-reload slash commands.
 * Ported from pi-quick-perms.
 */

export type PermissionSystemConfigFile = {
  permission?: FlatPermissionConfig;
  [key: string]: unknown;
};

export type QuickPermissionCommandController = {
  getGlobalConfigPath(): string;
  getProjectConfigPath(cwd: string): string;
};

export type ParsedRuleCommand = {
  tool: string;
  pattern: string;
};

type PolicyScope = "project" | "global";

type ScopedArgs = {
  scope: PolicyScope;
  args: string;
};

const explicitSurfaces = new Set([
  "*",
  "bash",
  "edit",
  "external_directory",
  "find",
  "grep",
  "ls",
  "mcp",
  "path",
  "read",
  "skill",
  "write",
]);

/** Return a warning message when the surface is not recognized. */
function warnUnknownSurface(surface: string, commandName?: string): void {
  const cmd = commandName ?? "allow";
  console.warn(
    `⚠️  /${cmd}: unknown surface "${surface}" — treated as bash. ` +
    `Valid surfaces: ${[...explicitSurfaces].filter(s => s !== "*").join(", ")}.`,
  );
}

/** Usage message showing the format (prefix is substituted per command). */
const USAGE_TEMPLATE =
  "Usage: /{command} [surface] <pattern>, for example /{command} bash gh api * or /{command} sudo *";

function formatUsage(commandName: string): string {
  return USAGE_TEMPLATE.replace(/\{command\}/g, commandName);
}

export function parseScope(args: string): ScopedArgs {
  const trimmed = args.trim();
  if (trimmed === "--global") {
    return { scope: "global", args: "" };
  }
  if (trimmed.startsWith("--global ")) {
    return { scope: "global", args: trimmed.slice("--global".length).trim() };
  }
  return { scope: "project", args: trimmed };
}

function resolveConfigPath(
  scope: PolicyScope,
  ctx: ExtensionCommandContext,
  controller: QuickPermissionCommandController,
): string {
  if (scope === "global") {
    return controller.getGlobalConfigPath();
  }

  if (!ctx.cwd) {
    throw new Error(
      "Project policy requires a working directory. Use --global to write global policy.",
    );
  }

  return controller.getProjectConfigPath(ctx.cwd);
}

export function parseRuleCommand(
  args: string,
  commandName?: string,
): ParsedRuleCommand {
  const parts = args.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 1 && parts[0] === "*") {
    return {
      tool: "*",
      pattern: "*",
    };
  }

  if (parts.length < 2) {
    throw new Error(formatUsage(commandName ?? "allow"));
  }

  const [tool, ...patternParts] = parts;
  const normalizedTool = tool.toLowerCase();

  if (!explicitSurfaces.has(normalizedTool)) {
    // Warn user about unknown surface instead of silent degradation.
    warnUnknownSurface(normalizedTool, commandName);
    return {
      tool: "bash",
      pattern: parts.join(" "),
    };
  }

  return {
    tool: normalizedTool,
    pattern: patternParts.join(" "),
  };
}

export function applyRule(
  config: PermissionSystemConfigFile,
  tool: string,
  pattern: string,
  action: PermissionState,
): PermissionSystemConfigFile {
  const permission = { ...(config.permission ?? {}) };
  if (tool === "*" && pattern === "*") {
    return {
      ...config,
      permission: {
        ...permission,
        "*": action,
      },
    };
  }

  const currentSurface = permission[tool];
  const toolRules = isRuleMap(currentSurface)
    ? { ...currentSurface }
    : preserveScalarSurface(currentSurface);

  toolRules[pattern] = action;
  permission[tool] = toolRules;

  return {
    ...config,
    permission,
  };
}

async function loadConfig(path: string): Promise<PermissionSystemConfigFile> {
  try {
    return JSON.parse(
      await readFile(path, "utf8"),
    ) as PermissionSystemConfigFile;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveConfig(
  path: string,
  config: PermissionSystemConfigFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function summarizePolicy(config: PermissionSystemConfigFile): string {
  const permission = config.permission ?? {};
  const entries = Object.entries(permission);

  if (entries.length === 0) {
    return "No permission rules configured.";
  }

  return entries
    .map(([surface, value]) => {
      if (!isRuleMap(value)) {
        return `${surface}: ${value}`;
      }

      const rules = Object.entries(value)
        .map(([pattern, action]) => `  ${pattern}: ${action}`)
        .join("\n");

      return `${surface}\n${rules}`;
    })
    .join("\n\n");
}

function preserveScalarSurface(
  value: PermissionState | Record<string, PermissionState> | undefined,
): Record<string, PermissionState> {
  return isPermissionState(value) ? { "*": value } : {};
}

function isRuleMap(
  value: PermissionState | Record<string, PermissionState> | undefined,
): value is Record<string, PermissionState> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// ── Exports for the unified /permission command ──────────────────────────
export {
  resolveConfigPath,
  loadConfig,
  saveConfig,
  summarizePolicy,
  formatUsage,
  USAGE_TEMPLATE,
};
