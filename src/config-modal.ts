import {
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import type { CommandConfigStore } from "./config-store";
import {
  DEFAULT_EXTENSION_CONFIG,
  type PermissionMode,
  type PermissionSystemExtensionConfig,
} from "./extension-config";
import type { Ruleset } from "./rule";

import {
  parseScope,
  parseRuleCommand,
  applyRule,
  loadConfig,
  saveConfig,
  resolveConfigPath,
  type QuickPermissionCommandController,
} from "./quick-commands";

interface PermissionConfigController {
  config: CommandConfigStore;
  /** Precomputed global config file path. */
  configPath: string;
  /** Returns the composed config-layer ruleset for the active agent scope. */
  getActiveAgentConfigRules(): Ruleset;
  /** Quick-command controller for policy file resolution. */
  quickController: QuickPermissionCommandController;
}

const USAGE_TEXT =
  "Usage: /permission [allow|block|ask|show|reset|mode|review-log|debug-log|help]\n" +
  "  /permission allow <surface> <pattern>\n" +
  "  /permission block <surface> <pattern>\n" +
  "  /permission ask <surface> <pattern>\n" +
  "  /permission mode <default|allowEdits|yolo>\n" +
  "  /permission review-log <on|off>\n" +
  "  /permission debug-log <on|off>\n" +
  "  /permission show\n" +
  "  /permission reset";

const COMMAND_ARGUMENTS = [
  { value: "allow", label: "Add allow rule", description: "/permission allow <surface> <pattern>" },
  { value: "block", label: "Add deny rule", description: "/permission block <surface> <pattern>" },
  { value: "ask", label: "Add ask rule", description: "/permission ask <surface> <pattern>" },
  { value: "show", label: "Show layered config", description: "Display config, mode, and layered policy rules" },
  { value: "reset", label: "Reset defaults", description: "Restore default mode/logging settings" },
  { value: "mode", label: "Set mode", description: "/permission mode <default|allowEdits|yolo>" },
  { value: "review-log", label: "Set review log", description: "/permission review-log <on|off>" },
  { value: "debug-log", label: "Set debug log", description: "/permission debug-log <on|off>" },
  { value: "help", label: "Show help", description: "Display command usage" },
] as const;

const VALID_MODES = new Set(["default", "allowEdits", "yolo"]);

function cloneDefaultConfig(): PermissionSystemExtensionConfig {
  return {
    debugLog: DEFAULT_EXTENSION_CONFIG.debugLog,
    permissionReviewLog: DEFAULT_EXTENSION_CONFIG.permissionReviewLog,
    mode: DEFAULT_EXTENSION_CONFIG.mode,
  };
}

function toOnOff(value: boolean): string {
  return value ? "on" : "off";
}

const LAYER_LABELS: Record<string, string> = {
  global: "═══ global ═══",
  project: "═══ project ═══",
  "project-agent": "═══ agent ═══",
  agent: "═══ agent ═══",
};

/** Group config rules by origin scope for layered display. */
function formatRulesByLayer(rules: Ruleset): string {
  const configRules = rules.filter((r) => r.layer === "config" && r.origin);
  if (configRules.length === 0) return "  (no policy rules configured)";

  // Group rules by origin scope, then by surface
  const grouped = new Map<string, Map<string, Ruleset>>();
  for (const r of configRules) {
    const origin = r.origin || "builtin";
    if (!grouped.has(origin)) grouped.set(origin, new Map());
    const surfaces = grouped.get(origin)!;
    if (!surfaces.has(r.surface)) surfaces.set(r.surface, []);
    surfaces.get(r.surface)!.push(r);
  }

  const parts: string[] = [];
  for (const [origin, surfaces] of grouped) {
    const label = LAYER_LABELS[origin];
    if (label) parts.push(label);

    const sectionLines: string[] = [];
    for (const [surface, rules] of surfaces) {
      // Determine catch-all icon
      const catchAll = rules.find((r) => r.pattern === "*");
      const icon = catchAll
        ? catchAll.action === "allow" ? "✓" : catchAll.action === "deny" ? "✗" : "?"
        : " ";

      const patterns = rules
        .filter((r) => r.pattern !== "*")
        .map((r) => {
          const pIcon = r.action === "allow" ? "✓" : r.action === "deny" ? "✗" : "?";
          return `    ${pIcon} ${r.pattern}`;
        });

      sectionLines.push(`  ${icon} ${surface}`);
      if (patterns.length > 0) sectionLines.push(...patterns);
    }
    parts.push(sectionLines.join("\n"));
  }

  return parts.length > 0 ? "\n" + parts.join("\n") : "  (no policy rules configured)";
}

function summarizeConfig(
  config: PermissionSystemExtensionConfig,
  rules?: Ruleset,
  globalPath?: string,
  projectPath?: string,
): string {
  const header = `  mode: ${config.mode}  |  review-log: ${toOnOff(config.permissionReviewLog)}  |  debug-log: ${toOnOff(config.debugLog)}`;
  const paths = [globalPath && `  global config: ${globalPath}`, projectPath && `  project config: ${projectPath}`]
    .filter(Boolean)
    .join("\n");
  const rulesBlock = rules ? formatRulesByLayer(rules) : "";
  return `${header}\n${paths}${rulesBlock}`;
}

function getArgumentCompletions(
  argumentPrefix: string,
): Array<{ value: string; label: string; description: string }> | null {
  const normalized = argumentPrefix.trim().toLowerCase();
  if (normalized.includes(" ")) {
    return null;
  }

  const filtered = COMMAND_ARGUMENTS.filter((item) =>
    item.value.startsWith(normalized),
  );
  return filtered.length > 0 ? [...filtered] : null;
}

export function registerPermissionCommand(
  pi: ExtensionAPI,
  controller: PermissionConfigController,
): void {
  pi.registerCommand("permission", {
    description:
      "Manage pi-permissions: rules, mode, logging, and config",
    getArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const subcommand = parts[0]?.toLowerCase();
      const rest = parts.slice(1).join(" ");

      if (!subcommand || subcommand === "help") {
        ctx.ui.notify(USAGE_TEXT, "info");
        return;
      }

      try {
        await handleSubcommand(subcommand, rest, ctx, controller);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}

async function handleSubcommand(
  sub: string,
  rest: string,
  ctx: ExtensionCommandContext,
  controller: PermissionConfigController,
): Promise<void> {
  const { config, configPath, getActiveAgentConfigRules, quickController } = controller;

  switch (sub) {
    // ── Rule commands ────────────────────────────────────────────────────
    case "allow":
    case "block":
    case "ask": {
      const action: Record<string, "allow" | "deny" | "ask"> = {
        allow: "allow", block: "deny", ask: "ask",
      };
      const scoped = parseScope(rest);
      const { tool, pattern } = parseRuleCommand(scoped.args, sub);

      if (pattern.length > 2000) {
        throw new Error(`Pattern too long (${pattern.length} characters, max 2000).`);
      }

      const cfgPath = resolveConfigPath(scoped.scope, ctx, quickController);
      const currentConfig = await loadConfig(cfgPath);
      const nextConfig = applyRule(currentConfig, tool, pattern, action[sub]);

      await saveConfig(cfgPath, nextConfig);
      ctx.ui.notify(
        `${sub}: ${tool} ${pattern}\nScope: ${scoped.scope}\nSaved to ${cfgPath}\nReloading...`,
        "info",
      );
      await ctx.reload();
      return;
    }

    // ── Config display ───────────────────────────────────────────────────
    case "show": {
      const rules = getActiveAgentConfigRules();
      const projectPath = ctx.cwd
        ? quickController.getProjectConfigPath(ctx.cwd)
        : undefined;
      ctx.ui.notify(
        summarizeConfig(config.current(), rules, configPath, projectPath),
        "info",
      );
      return;
    }

    case "reset": {
      config.save(cloneDefaultConfig(), ctx);
      ctx.ui.notify("Permission settings reset to defaults.", "info");
      return;
    }

    // ── Runtime knob commands ────────────────────────────────────────────
    case "mode": {
      const mode = rest.trim().toLowerCase();
      if (!VALID_MODES.has(mode)) {
        throw new Error(`Invalid mode '${rest}'. Valid values: default, allowEdits, yolo.`);
      }
      const current = config.current();
      config.save({ ...current, mode: mode as PermissionMode }, ctx);
      ctx.ui.notify(`mode → ${mode}`, "info");
      return;
    }

    case "review-log": {
      const value = rest.trim().toLowerCase();
      if (value !== "on" && value !== "off") {
        throw new Error("Usage: /permission review-log <on|off>");
      }
      const current = config.current();
      config.save({ ...current, permissionReviewLog: value === "on" }, ctx);
      ctx.ui.notify(`permissionReviewLog → ${value}`, "info");
      return;
    }

    case "debug-log": {
      const value = rest.trim().toLowerCase();
      if (value !== "on" && value !== "off") {
        throw new Error("Usage: /permission debug-log <on|off>");
      }
      const current = config.current();
      config.save({ ...current, debugLog: value === "on" }, ctx);
      ctx.ui.notify(`debugLog → ${value}`, "info");
      return;
    }

    default:
      ctx.ui.notify(USAGE_TEXT, "warning");
  }
}
