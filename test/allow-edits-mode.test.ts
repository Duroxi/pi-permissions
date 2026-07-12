import { describe, expect, test } from "vitest";

import {
  isAllowEditsModeEnabled,
  shouldAutoApproveForAllowEdits,
} from "#src/allow-edits-mode";
import type { PermissionSystemExtensionConfig } from "#src/extension-config";

function makeConfig(
  mode: "default" | "allowEdits" | "yolo",
): PermissionSystemExtensionConfig {
  return {
    debugLog: false,
    permissionReviewLog: true,
    mode,
    forwardedPromptTimeoutSeconds: 30,
  };
}

describe("isAllowEditsModeEnabled", () => {
  test("returns true when mode is allowEdits", () => {
    expect(isAllowEditsModeEnabled(makeConfig("allowEdits"))).toBe(true);
  });

  test("returns false when mode is default", () => {
    expect(isAllowEditsModeEnabled(makeConfig("default"))).toBe(false);
  });

  test("returns false when mode is yolo", () => {
    expect(isAllowEditsModeEnabled(makeConfig("yolo"))).toBe(false);
  });
});

describe("shouldAutoApproveForAllowEdits", () => {
  test("auto-approves write surface with ask state in CWD", () => {
    expect(
      shouldAutoApproveForAllowEdits("write", "ask", makeConfig("allowEdits")),
    ).toBe(true);
  });

  test("auto-approves edit surface with ask state in CWD", () => {
    expect(
      shouldAutoApproveForAllowEdits("edit", "ask", makeConfig("allowEdits")),
    ).toBe(true);
  });

  test("does not auto-approve when mode is default", () => {
    expect(
      shouldAutoApproveForAllowEdits("write", "ask", makeConfig("default")),
    ).toBe(false);
  });

  test("does not auto-approve when mode is yolo", () => {
    expect(
      shouldAutoApproveForAllowEdits("write", "ask", makeConfig("yolo")),
    ).toBe(false);
  });

  test("does not auto-approve when state is allow", () => {
    expect(
      shouldAutoApproveForAllowEdits("write", "allow", makeConfig("allowEdits")),
    ).toBe(false);
  });

  test("does not auto-approve when state is deny", () => {
    expect(
      shouldAutoApproveForAllowEdits("write", "deny", makeConfig("allowEdits")),
    ).toBe(false);
  });

  test("does not auto-approve bash surface", () => {
    expect(
      shouldAutoApproveForAllowEdits("bash", "ask", makeConfig("allowEdits")),
    ).toBe(false);
  });

  test("does not auto-approve read surface", () => {
    expect(
      shouldAutoApproveForAllowEdits("read", "ask", makeConfig("allowEdits")),
    ).toBe(false);
  });

  test("does not auto-approve mcp surface", () => {
    expect(
      shouldAutoApproveForAllowEdits("mcp", "ask", makeConfig("allowEdits")),
    ).toBe(false);
  });

  test("does not auto-approve external paths", () => {
    expect(
      shouldAutoApproveForAllowEdits(
        "write",
        "ask",
        makeConfig("allowEdits"),
        true, // isExternalPath
      ),
    ).toBe(false);
  });

  test("does not auto-approve when surface is undefined", () => {
    expect(
      shouldAutoApproveForAllowEdits(
        undefined,
        "ask",
        makeConfig("allowEdits"),
      ),
    ).toBe(false);
  });

  test("handles case-insensitive surface names", () => {
    expect(
      shouldAutoApproveForAllowEdits("Write", "ask", makeConfig("allowEdits")),
    ).toBe(true);
    expect(
      shouldAutoApproveForAllowEdits("EDIT", "ask", makeConfig("allowEdits")),
    ).toBe(true);
  });

  test("handles surface with whitespace", () => {
    expect(
      shouldAutoApproveForAllowEdits("  write  ", "ask", makeConfig("allowEdits")),
    ).toBe(true);
  });
});
