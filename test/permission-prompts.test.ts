import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock tool-input-preview collaborator before importing the module under test.
vi.mock("#src/tool-input-preview.js", () => ({
  formatToolInputForPrompt: vi.fn(() => "mocked preview"),
  getPromptPath: (input: Record<string, unknown>) =>
    typeof input.path === "string"
      ? input.path
      : typeof input.file_path === "string"
        ? input.file_path
        : null,
  countTextLines: (value: string) => value.split(/\r\n|\r|\n/).length,
  formatCount: (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`,
}));

import {
  formatAskPrompt,
  formatDenyReason,
  formatMissingToolNameReason,
  formatPermissionHardStopHint,
  formatSkillAskPrompt,
  formatSkillPathAskPrompt,
  formatSkillPathDenyReason,
  formatUnknownToolReason,
  formatUserDeniedReason,
} from "#src/permission-prompts";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import { formatToolInputForPrompt } from "#src/tool-input-preview";
import type { PermissionCheckResult } from "#src/types";

const mockedFormatToolInput = vi.mocked(formatToolInputForPrompt);

beforeEach(() => {
  mockedFormatToolInput.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function toolResult(
  toolName: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function mcpResult(
  target: string,
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "mcp",
    target,
    state: "ask",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

function skillEntry(name: string): SkillPromptEntry {
  return {
    name,
    description: "A skill",
    location: `/skills/${name}/SKILL.md`,
    state: "ask",
    normalizedLocation: `/skills/${name}/SKILL.md`,
    normalizedBaseDir: `/skills/${name}`,
  };
}

describe("formatMissingToolNameReason", () => {
  test("mentions missing tool name and pi.getAllTools()", () => {
    const result = formatMissingToolNameReason();
    expect(result).toContain("no tool name");
    expect(result).toContain("pi.getAllTools()");
  });
});

describe("formatUnknownToolReason", () => {
  test("mentions the unknown tool name and lists available tools", () => {
    const result = formatUnknownToolReason("phantom", ["read", "write"]);
    expect(result).toContain("phantom");
    expect(result).toContain("read");
    expect(result).toContain("write");
  });

  test("includes MCP hint for non-mcp tool names", () => {
    const result = formatUnknownToolReason("my-server:tool", ["mcp"]);
    expect(result).toContain("mcp");
  });

  test("omits MCP hint when tool name is 'mcp'", () => {
    const result = formatUnknownToolReason("mcp", []);
    expect(result).not.toContain("call the registered 'mcp' tool");
  });

  test("shows 'none' when no tools are registered", () => {
    const result = formatUnknownToolReason("ghost", []);
    expect(result).toContain("none");
  });

  test("caps preview at 10 tools and appends ellipsis for longer lists", () => {
    const tools = Array.from({ length: 15 }, (_, i) => `tool${i}`);
    const result = formatUnknownToolReason("ghost", tools);
    expect(result).toContain("...");
  });
});

describe("formatPermissionHardStopHint", () => {
  test("returns MCP-specific message for mcp tool with target", () => {
    const result = formatPermissionHardStopHint(mcpResult("server:tool"));
    expect(result).toContain("MCP permission denial");
  });

  test("returns MCP-specific message for mcp source with target", () => {
    const result = formatPermissionHardStopHint(
      toolResult("anything", { source: "mcp", target: "server:tool" }),
    );
    expect(result).toContain("MCP permission denial");
  });

  test("returns generic message for non-MCP tools", () => {
    const result = formatPermissionHardStopHint(toolResult("read"));
    expect(result).toContain("Hard stop");
    expect(result).not.toContain("MCP");
  });
});

describe("formatDenyReason", () => {
  test("includes tool name and hard stop hint", () => {
    const result = formatDenyReason(toolResult("read"));
    expect(result).toContain("read");
    expect(result).toContain("Hard stop");
  });

  test("includes agent name when provided", () => {
    const result = formatDenyReason(toolResult("write"), "my-agent");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("includes MCP target for mcp results", () => {
    const result = formatDenyReason(mcpResult("server:do-thing"));
    expect(result).toContain("server:do-thing");
    expect(result).toContain("MCP");
  });

  test("includes bash command when present", () => {
    const result = formatDenyReason(
      toolResult("bash", { command: "rm -rf /" }),
    );
    expect(result).toContain("rm -rf /");
  });

  test("includes matched pattern when present", () => {
    const result = formatDenyReason(
      toolResult("bash", { command: "rm -rf /", matchedPattern: "rm *" }),
    );
    expect(result).toContain("matched 'rm *'");
  });
});

describe("formatUserDeniedReason", () => {
  test("uses concise text for user-denied generic tools", () => {
    const result = formatUserDeniedReason(toolResult("read"));
    expect(result).toBe("Tool denied by user: read.");
    expect(result).not.toContain("Hard stop");
  });

  test("uses concise text for user-denied bash results", () => {
    const result = formatUserDeniedReason(
      toolResult("bash", { command: "sudo ls -l" }),
    );
    expect(result).toBe("Bash command denied by user: sudo ls -l.");
    expect(result).not.toContain("Hard stop");
    expect(result).not.toContain("Do not retry");
  });

  test("mentions MCP target for mcp results", () => {
    const result = formatUserDeniedReason(mcpResult("server:query"));
    expect(result).toContain("server:query");
  });

  test("appends denial reason when provided", () => {
    const result = formatUserDeniedReason(toolResult("read"), "too sensitive");
    expect(result).toContain("Reason: too sensitive");
  });

  test("omits reason suffix when not provided", () => {
    const result = formatUserDeniedReason(toolResult("read"));
    expect(result).not.toContain("Reason:");
  });
});

describe("formatAskPrompt", () => {
  test("formats read with path", () => {
    const result = formatAskPrompt(toolResult("read"), {
      path: "/src",
    });
    expect(result).toBe("read(/src)");
  });

  test("formats write with path and matched pattern", () => {
    const result = formatAskPrompt(
      toolResult("write", { matchedPattern: ".env.*" }),
      { path: ".env" },
    );
    expect(result).toBe("write(.env (1 lines, 0 characters)) [matched: .env.*]");
  });

  test("formats bash with command", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git status" }),
    );
    expect(result).toBe("bash(git status)");
    expect(mockedFormatToolInput).not.toHaveBeenCalled();
  });

  test("formats bash with command and matched pattern", () => {
    const result = formatAskPrompt(
      toolResult("bash", { command: "git push", matchedPattern: "git *" }),
    );
    expect(result).toBe("bash(git push) [matched: git *]");
  });

  test("formats mcp with target", () => {
    const result = formatAskPrompt(mcpResult("server:query"));
    expect(result).toBe("mcp(server:query)");
    expect(mockedFormatToolInput).not.toHaveBeenCalled();
  });

  test("formats mcp with target and matched pattern", () => {
    const result = formatAskPrompt(
      mcpResult("server:query", { matchedPattern: "server:*" }),
    );
    expect(result).toBe("mcp(server:query) [matched: server:*]");
  });

  test("formats grep with pattern and path", () => {
    const result = formatAskPrompt(
      toolResult("grep"),
      { pattern: "console.log", path: "/src" },
    );
    expect(result).toBe("grep(console.log /src)");
  });

  test("formats find with path", () => {
    const result = formatAskPrompt(
      toolResult("find"),
      { path: "/src" },
    );
    expect(result).toBe("find(/src)");
  });

  test("formats find with path and name", () => {
    const result = formatAskPrompt(
      toolResult("find"),
      { path: "/src", name: "*.test.ts" },
    );
    expect(result).toBe('find(/src --name "*.test.ts")');
  });

  test("formats ls with path", () => {
    const result = formatAskPrompt(
      toolResult("ls"),
      { path: "/src" },
    );
    expect(result).toBe("ls(/src)");
  });

  test("omits matched pattern when it is wildcard", () => {
    const result = formatAskPrompt(
      toolResult("write", { matchedPattern: "*" }),
      { path: "/src/foo.ts" },
    );
    expect(result).toBe("write(/src/foo.ts (1 lines, 0 characters))");
  });

  test("formats edit with path and single replacement", () => {
    const result = formatAskPrompt(
      toolResult("edit"),
      { path: "/src/foo.ts", edits: [{ oldText: "a\nb", newText: "c\nd" }] },
    );
    expect(result).toBe(
      "edit(/src/foo.ts (1 replacement: edit #1 replaces 2 lines with 2 lines))",
    );
  });

  test("formats edit with multiple replacements", () => {
    const result = formatAskPrompt(
      toolResult("edit"),
      {
        path: "/src/foo.ts",
        edits: [
          { oldText: "a", newText: "b" },
          { oldText: "c", newText: "d" },
        ],
      },
    );
    expect(result).toBe(
      "edit(/src/foo.ts (2 replacements: edit #1 replaces 1 line with 1 line, plus 1 additional edit))",
    );
  });

  test("formats edit without path", () => {
    const result = formatAskPrompt(
      toolResult("edit"),
      { edits: [{ oldText: "a", newText: "b" }] },
    );
    expect(result).toBe("edit((1 replacement: edit #1 replaces 1 line with 1 line))");
  });

  test("formats edit with empty edits array", () => {
    const result = formatAskPrompt(
      toolResult("edit"),
      { path: "/src/foo.ts", edits: [] },
    );
    expect(result).toBe("edit(/src/foo.ts with edit input)");
  });

  test("formats edit with oldText/newText fallback", () => {
    const result = formatAskPrompt(
      toolResult("edit"),
      { path: "/src/foo.ts", oldText: "a", newText: "b" },
    );
    expect(result).toBe(
      "edit(/src/foo.ts (1 replacement: edit #1 replaces 1 line with 1 line))",
    );
  });

  test("handles unknown tool with mocked input preview", () => {
    const formatter = {
      sanitizeInlineText: (value: string) => value,
      formatToolInputForPrompt: (_tool: string, _input: unknown) => "mocked preview",
    } as any;
    const result = formatAskPrompt(
      toolResult("task"),
      { path: "/src" },
      formatter,
    );
    expect(result).toBe("task(mocked preview)");
  });
});

describe("formatSkillAskPrompt", () => {
  test("returns skill(name) format", () => {
    const result = formatSkillAskPrompt("librarian");
    expect(result).toBe("skill(librarian)");
  });
});

describe("formatSkillPathAskPrompt", () => {
  test("returns read(path) format", () => {
    const result = formatSkillPathAskPrompt(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
    );
    expect(result).toBe("read(/skills/librarian/SKILL.md)");
  });
});

describe("formatSkillPathDenyReason", () => {
  test("includes skill name, read path, and agent name", () => {
    const result = formatSkillPathDenyReason(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
      "my-agent",
    );
    expect(result).toContain("librarian");
    expect(result).toContain("/skills/librarian/SKILL.md");
    expect(result).toContain("Agent 'my-agent'");
  });

  test("uses 'Current agent' without agent name", () => {
    const result = formatSkillPathDenyReason(
      skillEntry("librarian"),
      "/skills/librarian/SKILL.md",
    );
    expect(result).toContain("Current agent");
  });
});
