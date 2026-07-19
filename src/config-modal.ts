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
  summarizePolicy,
  formatUsage,
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
  "Usage: /permission [allow|block|ask|show|reset|policy|reload|mode|review-log|debug-log|help]\n" +
  "  /permission allow <surface> <pattern>\n" +
  "  /permission block <surface> <pattern>\n" +
  "  /permission ask <surface> <pattern>\n" +
  "  /permission mode <default|allowEdits|yolo>\n" +
  "  /permission review-log <on|off>\n" +
  "  /permission debug-log <on|off>\n" +
  "  /permission show\n" +
  "  /permission reset\n" +
  "  /permission policy [--global]\n" +
  "  /permission reload";

const COMMAND_ARGUMENTS = [
  { value: "allow", label: "Add allow rule", description: "/permission allow <surface> <pattern>" },
  { value: "block", label: "Add deny rule", description: "/permission block <surface> <pattern>" },
  { value: "ask", label: "Add ask rule", description: "/permission ask <surface> <pattern>" },
  { value: "show", label: "Show config + path", description: "Display config summary and config.json path" },
  { value: "reset", label: "Reset defaults", description: "Restore default mode/logging settings" },
  { value: "policy", label: "Show policy", description: "Show the active permission policy file" },
  { value: "reload", label: "Reload config", description: "Reload Pi resources after policy changes" },
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

function formatMode(mode: PermissionMode): string {
  switch (mode) {
    case "default": return "default (always prompt)";
    case "allowEdits": return "allowEdits (auto-approve write/edit in CWD)";
    case "yolo": return "yolo (auto-approve all)";
  }
}

function formatRulesSummary(rules: Ruleset): string {
  const configRules = rules.filter((r) => r.layer === "config" && r.origin);
  if (configRules.length === 0) return "";
  // Group rules by surface
  const grouped = new Map<string, string[]>();
  for (const r of configRules) {
    if (!grouped.has(r.surface)) grouped.set(r.surface, []);
    const action = r.action === "allow" ? "✓" : r.action === "deny" ? "✗" : "?";
    grouped.get(r.surface)!.push(
      r.pattern === "*" ? action : `  ${r.pattern} → ${action}`,
    );
  }
  return "\n" + [...grouped.entries()]
    .map(([surface, patterns]) => {
      const header = surface;
      return `  ${header}\n${patterns.join("\n")}`;
    })
    .join("\n");
}

function summarizeConfig(
  config: PermissionSystemExtensionConfig,
  rules?: Ruleset,
): string {
  const header = `  mode: ${config.mode}  |  review-log: ${toOnOff(config.permissionReviewLog)}  |  debug-log: ${toOnOff(config.debugLog)}`;
  const rulesSuffix = rules ? formatRulesSummary(rules) : "";
  return `${header}${rulesSuffix}`;
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

      const configPath_ = resolveConfigPath(scoped.scope, ctx, quickController);
      const currentConfig = await loadConfig(configPath_);
      const nextConfig = applyRule(currentConfig, tool, pattern, action[sub]);

      await saveConfig(configPath_, nextConfig);
      ctx.ui.notify(
        `${sub}: ${tool} ${pattern}\nScope: ${scoped.scope}\nSaved to ${configPath_}\nReloading...`,
        "info",
      );
      await ctx.reload();
      return;
    }

    // ── Config display commands ──────────────────────────────────────────
    case "show": {
      const rules = getActiveAgentConfigRules();
      ctx.ui.notify(
        `[config] ${configPath}\n${summarizeConfig(config.current(), rules)}\n[policy]`,
        "info",
      );
      return;
    }

    case "reset": {
      config.save(cloneDefaultConfig(), ctx);
      ctx.ui.notify("Permission settings reset to defaults.", "info");
      return;
    }

    // ── Policy commands ──────────────────────────────────────────────────
    case "policy": {
      const scoped = parseScope(rest);
      const policyPath = resolveConfigPath(scoped.scope, ctx, quickController);
      const policyConfig = await loadConfig(policyPath);
      const fallback =
        scoped.scope === "project"
          ? `\nGlobal fallback: ${quickController.getGlobalConfigPath()}`
          : "";
      ctx.ui.notify(
        `Scope: ${scoped.scope}\nPolicy file: ${policyPath}${fallback}\n\n${summarizePolicy(policyConfig)}`,
        "info",
      );
      return;
    }

    case "reload": {
      await ctx.reload();
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
