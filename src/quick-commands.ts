import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ExtensionAPI,
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

type QuickPermissionCommandController = {
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

/** Usage message showing the format (prefix is substituted per command). */
const USAGE_TEMPLATE =
  "Usage: /{command} [surface] <pattern>, for example /{command} bash gh api * or /{command} sudo *";

function formatUsage(commandName: string): string {
  return USAGE_TEMPLATE.replace(/\{command\}/g, commandName);
}

/**
 * Register quick permission commands (/allow, /block, /ask, /policy, /policy-reload).
 * Ported from pi-quick-perms.
 */
export function registerQuickPermissionCommands(
  pi: ExtensionAPI,
  controller: QuickPermissionCommandController,
): void {
  registerRuleCommand(
    pi,
    controller,
    "allow",
    "Add an allow rule and reload permission config",
    "allow",
  );
  registerRuleCommand(
    pi,
    controller,
    "ask",
    "Add an ask rule and reload permission config",
    "ask",
  );
  registerRuleCommand(
    pi,
    controller,
    "block",
    "Add a deny rule and reload permission config",
    "deny",
  );

  pi.registerCommand("policy", {
    description:
      "Show the active permission policy file",
    handler: async (args, ctx) => {
      try {
        const scoped = parseScope(args);
        const configPath = resolveConfigPath(scoped.scope, ctx, controller);
        const config = await loadConfig(configPath);
        const fallback =
          scoped.scope === "project"
            ? `\nGlobal fallback: ${controller.getGlobalConfigPath()}`
            : "";
        ctx.ui.notify(
          `Scope: ${scoped.scope}\nPolicy file: ${configPath}${fallback}\n\n${summarizePolicy(config)}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });

  pi.registerCommand("policy-reload", {
    description: "Reload Pi resources after permission policy changes",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
}

function registerRuleCommand(
  pi: ExtensionAPI,
  controller: QuickPermissionCommandController,
  name: string,
  description: string,
  action: PermissionState,
): void {
  pi.registerCommand(name, {
    description,
    handler: async (args, ctx) => {
      try {
        const scoped = parseScope(args);
        const { tool, pattern } = parseRuleCommand(scoped.args, name);
        if (pattern.length > 2000) {
          throw new Error(
            `Pattern too long (${pattern.length} characters, max 2000).`,
          );
        }
        const configPath = resolveConfigPath(scoped.scope, ctx, controller);
        const currentConfig = await loadConfig(configPath);
        const nextConfig = applyRule(currentConfig, tool, pattern, action);

        await saveConfig(configPath, nextConfig);
        ctx.ui.notify(
          `${name}: ${tool} ${pattern}\nScope: ${scoped.scope}\nSaved to ${configPath}\nReloading...`,
          "info",
        );
        await ctx.reload();
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
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
