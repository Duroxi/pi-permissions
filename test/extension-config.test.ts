import { describe, expect, it } from "vitest";

import {
  detectMisplacedPermissionKeys,
  normalizePermissionSystemConfig,
  resolveModeFromRecord,
} from "#src/extension-config";

describe("detectMisplacedPermissionKeys", () => {
  it("returns an empty array for a record with only valid extension keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      permissionReviewLog: true,
      yoloMode: false,
    });
    expect(result).toEqual([]);
  });

  it("returns an empty array for an empty record", () => {
    const result = detectMisplacedPermissionKeys({});
    expect(result).toEqual([]);
  });

  it("returns misplaced key names when legacy permission-rule keys are present", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      defaultPolicy: { tools: "ask" },
      bash: { "git status": "allow" },
    });
    expect(result).toEqual(["bash"]);
  });

  it("detects all known legacy permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      bash: {},
      mcp: {},
      skills: {},
      special: {},
      external_directory: {},
    });
    expect(result).toEqual([
      "bash",
      "mcp",
      "skills",
      "special",
      "external_directory",
    ]);
  });

  it("does not detect doom_loop as a misplaced permission key", () => {
    const result = detectMisplacedPermissionKeys({
      doom_loop: {},
    });
    expect(result).toEqual([]);
  });

  it("does not flag the new flat-format permission key as misplaced", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: false,
      permission: { "*": "ask" },
    });
    expect(result).toEqual([]);
  });

  it("ignores unknown keys that are not permission-rule keys", () => {
    const result = detectMisplacedPermissionKeys({
      debugLog: true,
      someRandomKey: "value",
    });
    expect(result).toEqual([]);
  });
});

describe("normalizePermissionSystemConfig", () => {
  it("normalizes a valid config object with mode", () => {
    const result = normalizePermissionSystemConfig({
      debugLog: true,
      permissionReviewLog: false,
      mode: "yolo",
    });
    expect(result).toEqual({
      debugLog: true,
      permissionReviewLog: false,
      mode: "yolo",
      forwardedPromptTimeoutSeconds: 30,
    });
  });

  it("defaults debugLog to false when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.debugLog).toBe(false);
  });

  it("defaults permissionReviewLog to true when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.permissionReviewLog).toBe(true);
  });

  it("defaults mode to default when missing", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.mode).toBe("default");
  });

  it("maps yoloMode: true to mode: yolo for backward compatibility", () => {
    const result = normalizePermissionSystemConfig({
      yoloMode: true,
    });
    expect(result.mode).toBe("yolo");
  });

  it("mode field takes precedence over yoloMode", () => {
    const result = normalizePermissionSystemConfig({
      mode: "allowEdits",
      yoloMode: true,
    });
    expect(result.mode).toBe("allowEdits");
  });

  it("includes toolInputPreviewMaxLength when a valid positive integer is provided", () => {
    const result = normalizePermissionSystemConfig({
      toolInputPreviewMaxLength: 400,
    });
    expect(result.toolInputPreviewMaxLength).toBe(400);
  });

  it("omits toolInputPreviewMaxLength when absent", () => {
    const result = normalizePermissionSystemConfig({});
    expect("toolInputPreviewMaxLength" in result).toBe(false);
  });

  it("includes toolTextSummaryMaxLength when a valid positive integer is provided", () => {
    const result = normalizePermissionSystemConfig({
      toolTextSummaryMaxLength: 120,
    });
    expect(result.toolTextSummaryMaxLength).toBe(120);
  });

  it("omits toolTextSummaryMaxLength when absent", () => {
    const result = normalizePermissionSystemConfig({});
    expect("toolTextSummaryMaxLength" in result).toBe(false);
  });

  it("includes forwardedPromptTimeoutSeconds when provided", () => {
    const result = normalizePermissionSystemConfig({
      forwardedPromptTimeoutSeconds: 60,
    });
    expect(result.forwardedPromptTimeoutSeconds).toBe(60);
  });

  it("allows null forwardedPromptTimeoutSeconds to disable timeout", () => {
    const result = normalizePermissionSystemConfig({
      forwardedPromptTimeoutSeconds: null,
    });
    expect(result.forwardedPromptTimeoutSeconds).toBeNull();
  });

  it("defaults forwardedPromptTimeoutSeconds to 30", () => {
    const result = normalizePermissionSystemConfig({});
    expect(result.forwardedPromptTimeoutSeconds).toBe(30);
  });
});

describe("resolveModeFromRecord", () => {
  it("returns default when record is empty", () => {
    expect(resolveModeFromRecord({})).toBe("default");
  });

  it("returns mode from explicit mode field", () => {
    expect(resolveModeFromRecord({ mode: "allowEdits" })).toBe("allowEdits");
    expect(resolveModeFromRecord({ mode: "yolo" })).toBe("yolo");
    expect(resolveModeFromRecord({ mode: "default" })).toBe("default");
  });

  it("maps yoloMode: true to yolo", () => {
    expect(resolveModeFromRecord({ yoloMode: true })).toBe("yolo");
  });

  it("ignores yoloMode: false", () => {
    expect(resolveModeFromRecord({ yoloMode: false })).toBe("default");
  });

  it("mode field takes precedence over yoloMode", () => {
    expect(
      resolveModeFromRecord({ mode: "allowEdits", yoloMode: true }),
    ).toBe("allowEdits");
  });

  it("rejects invalid mode values", () => {
    expect(resolveModeFromRecord({ mode: "invalid" })).toBe("default");
    expect(resolveModeFromRecord({ mode: "" })).toBe("default");
    expect(resolveModeFromRecord({ mode: 123 })).toBe("default");
  });
});
