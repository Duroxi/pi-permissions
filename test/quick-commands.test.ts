import { describe, expect, test } from "vitest";

// The quick commands module is primarily integration-tested through the Pi
// extension API. These unit tests verify the pure helper functions that
// don't require mocking the ExtensionAPI.

// We test the exported functions indirectly through their behavior.
// The registerQuickPermissionCommands function requires ExtensionAPI mock,
// so we focus on testing the parsing and config logic that would be used.

describe("quick-commands module structure", () => {
  test("module exports parseScope", async () => {
    const mod = await import("#src/quick-commands");
    expect(typeof mod.parseScope).toBe("function");
  });

  test("module exports parseRuleCommand", async () => {
    const mod = await import("#src/quick-commands");
    expect(typeof mod.parseRuleCommand).toBe("function");
  });

  test("module exports applyRule", async () => {
    const mod = await import("#src/quick-commands");
    expect(typeof mod.applyRule).toBe("function");
  });
});

describe("parseScope", () => {
  test("returns project scope for empty string", async () => {
    const { parseScope } = await import("#src/quick-commands");
    expect(parseScope("").scope).toBe("project");
  });

  test("returns project scope for whitespace-only string", async () => {
    const { parseScope } = await import("#src/quick-commands");
    expect(parseScope("   ").scope).toBe("project");
  });

  test("returns global scope for --global flag alone", async () => {
    const { parseScope } = await import("#src/quick-commands");
    expect(parseScope("--global").scope).toBe("global");
  });

  test("returns global scope for --global flag with args", async () => {
    const { parseScope } = await import("#src/quick-commands");
    const result = parseScope("--global write *");
    expect(result.scope).toBe("global");
    expect(result.args).toBe("write *");
  });

  test("returns project scope when --global is inside args", async () => {
    const { parseScope } = await import("#src/quick-commands");
    const result = parseScope("bash --global option");
    expect(result.scope).toBe("project");
    expect(result.args).toBe("bash --global option");
  });
});

describe("parseRuleCommand", () => {
  test("parses simple tool and pattern", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("bash git status");
    expect(result.tool).toBe("bash");
    expect(result.pattern).toBe("git status");
  });

  test("uses bash as default when tool is not recognized", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("unknown command here");
    expect(result.tool).toBe("bash");
    expect(result.pattern).toBe("unknown command here");
  });

  test('handles single "*" as wildcard tool and pattern', async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("*");
    expect(result.tool).toBe("*");
    expect(result.pattern).toBe("*");
  });

  test('handles "*" as tool with explicit pattern', async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("* foo");
    expect(result.tool).toBe("*");
    expect(result.pattern).toBe("foo");
  });

  test("recognizes write as explicit surface", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("write src/**");
    expect(result.tool).toBe("write");
    expect(result.pattern).toBe("src/**");
  });

  test("recognizes edit as explicit surface", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("edit src/file.ts");
    expect(result.tool).toBe("edit");
    expect(result.pattern).toBe("src/file.ts");
  });

  test("recognizes mcp as explicit surface", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("mcp *");
    expect(result.tool).toBe("mcp");
    expect(result.pattern).toBe("*");
  });

  test("throws on single non-wildcard argument", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    expect(() => parseRuleCommand("justone")).toThrow();
  });

  test("throws on empty input", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    expect(() => parseRuleCommand("")).toThrow();
  });

  test("recognizes surface case-insensitively", async () => {
    const { parseRuleCommand } = await import("#src/quick-commands");
    const result = parseRuleCommand("Bash git status");
    expect(result.tool).toBe("bash");
    expect(result.pattern).toBe("git status");
  });
});

describe("applyRule", () => {
  test("adds wildcard allow rule to an empty config", async () => {
    const { applyRule } = await import("#src/quick-commands");
    const result = applyRule({}, "*", "*", "allow");
    expect(result.permission).toEqual({ "*": "allow" });
  });

  test("adds surface-specific ask rule", async () => {
    const { applyRule } = await import("#src/quick-commands");
    const result = applyRule({}, "bash", "git *", "ask");
    expect(result.permission).toEqual({ bash: { "git *": "ask" } });
  });

  test("adds multiple rules to same surface", async () => {
    const { applyRule } = await import("#src/quick-commands");
    let config = applyRule({}, "read", "src/**", "allow");
    config = applyRule(config, "read", "test/**", "allow");
    expect(config.permission).toEqual({
      read: { "src/**": "allow", "test/**": "allow" },
    });
  });

  test("preserves existing unrelated surfaces", async () => {
    const { applyRule } = await import("#src/quick-commands");
    let config = applyRule({}, "bash", "npm *", "allow");
    config = applyRule(config, "write", "*.ts", "ask");
    expect(config.permission).toEqual({
      bash: { "npm *": "allow" },
      write: { "*.ts": "ask" },
    });
  });

  test("replaces scalar surface with object map", async () => {
    const { applyRule } = await import("#src/quick-commands");
    const config = { permission: { bash: "allow" as const } };
    const result = applyRule(config, "bash", "git *", "ask");
    expect(result.permission).toEqual({
      bash: { "*": "allow", "git *": "ask" },
    });
  });
});
