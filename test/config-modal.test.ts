import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { loadUnifiedConfig } from "#src/config-loader";
import { registerPermissionCommand } from "#src/config-modal";
import type { CommandConfigStore } from "#src/config-store";
import {
  DEFAULT_EXTENSION_CONFIG,
  normalizePermissionSystemConfig,
  type PermissionSystemExtensionConfig,
} from "#src/extension-config";
import type { Rule, Ruleset } from "#src/rule";

type Notification = { message: string; level: "info" | "warning" | "error" };

type CommandContextStub = {
  hasUI: boolean;
  ui: {
    notify(message: string, level: "info" | "warning" | "error"): void;
  };
  reload?(): Promise<void>;
};

function createContext(hasUI: boolean): CommandContextStub {
  return {
    hasUI,
    ui: { notify: vi.fn() },
    reload: vi.fn().mockResolvedValue(undefined),
  };
}

function lastNotification(notifications: Notification[]): Notification {
  return notifications[notifications.length - 1];
}

function makeController(configStore: CommandConfigStore, configPath: string) {
  return {
    config: configStore,
    configPath,
    getActiveAgentConfigRules: () => [] as Ruleset,
    quickController: {
      getGlobalConfigPath: () => configPath,
      getProjectConfigPath: (cwd: string) => join(cwd, ".pi", "extensions", "pi-permissions", "config.json"),
    },
  };
}

test("permission command completions expose all subcommands", () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const configStore: CommandConfigStore = {
    current: () => config,
    save: vi.fn(),
  };
  const controller = makeController(configStore, "/fake/config.json");

  let definition: {
    description: string;
    getArgumentCompletions?: (
      argumentPrefix: string,
    ) => Array<{ value: string; label: string; description?: string }> | null;
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionCommand(
    {
      registerCommand(_name: string, nextDefinition: typeof definition) {
        definition = nextDefinition;
      },
    } as never,
    controller,
  );

  expect(definition!.getArgumentCompletions).toBeTypeOf("function");

  const topLevel = definition!.getArgumentCompletions?.("");
  expect(topLevel?.some((item) => item.value === "show")).toBeTruthy();
  expect(topLevel?.some((item) => item.value === "allow")).toBeTruthy();
  expect(topLevel?.some((item) => item.value === "mode")).toBeTruthy();
  expect(topLevel?.some((item) => item.value === "policy")).toBeTruthy();
  expect(topLevel?.some((item) => item.value === "reload")).toBeTruthy();

  const filtered = definition!.getArgumentCompletions?.("po");
  expect(filtered?.map((item) => item.value)).toEqual(["policy"]);
  expect(definition!.getArgumentCompletions?.("zzz")).toBe(null);
});

test("permission show displays config summary", async () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const configStore: CommandConfigStore = {
    current: () => config,
    save: vi.fn(),
  };
  const controller = makeController(configStore, "/test/config.json");

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller,
  );

  const ctx = createContext(true);
  await definition!.handler("show", ctx);
  const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(msg).toContain("mode: default");
  expect(msg).toContain("review-log: on");
});

test("permission show displays config and path", async () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const configStore: CommandConfigStore = {
    current: () => config,
    save: vi.fn(),
  };
  const controller = makeController(configStore, "/test/config.json");

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller,
  );

  // /permission show — includes path
  const ctx1 = createContext(true);
  await definition!.handler("show", ctx1);
  const msg1 = (ctx1.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(msg1).toContain("mode: default");
  expect(msg1).toContain("/test/config.json");
});

test("permission help shows usage", async () => {
  const config = { ...DEFAULT_EXTENSION_CONFIG };
  const configStore: CommandConfigStore = {
    current: () => config,
    save: vi.fn(),
  };
  const controller = makeController(configStore, "/test/config.json");

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller,
  );

  const ctx = createContext(true);
  await definition!.handler("help", ctx);
  const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(msg).toContain("/permission");
  expect(msg).toContain("allow");
  expect(msg).toContain("mode");
});

test("permission reset restores defaults", async () => {
  const config: PermissionSystemExtensionConfig = {
    debugLog: true,
    permissionReviewLog: false,
    mode: "allowEdits",
  };
  const configPath = join(tmpdir(), "pi-permissions-reset-test.json");
  const configStore: CommandConfigStore = {
    current: () => config,
    save: (next) => {
      writeFileSync(configPath, JSON.stringify(next, null, 2), "utf-8");
    },
  };
  const controller = makeController(configStore, configPath);

  let definition: {
    handler: (args: string, ctx: CommandContextStub) => Promise<void>;
  } | null = null;

  registerPermissionCommand(
    {
      registerCommand(_name: string, nextDef: typeof definition) {
        definition = nextDef;
      },
    } as never,
    controller,
  );

  const ctx = createContext(true);
  await definition!.handler("reset", ctx);
  const msg = (ctx.ui.notify as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(msg).toContain("reset to defaults");

  // Verify file was written with defaults
  const persisted = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  expect(persisted.mode).toBe("default");
});
