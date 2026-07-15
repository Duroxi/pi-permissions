import { describe, expect, it, vi } from "vitest";
import {
  createDeniedPermissionDecision,
  isPermissionDecisionState,
  normalizePermissionDenialReason,
  type PermissionDecisionUi,
  requestPermissionDecisionFromUi,
} from "#src/permission-dialog";

describe("isPermissionDecisionState", () => {
  const VALID = ["approved", "denied", "denied_with_reason", "approved_for_session"];
  it("accepts all valid decision states", () => {
    for (const state of VALID) {
      expect(isPermissionDecisionState(state)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isPermissionDecisionState("unknown")).toBe(false);
    expect(isPermissionDecisionState(42)).toBe(false);
    expect(isPermissionDecisionState(null)).toBe(false);
  });
});

describe("requestPermissionDecisionFromUi", () => {
  it("returns approved when user selects Yes", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("Yes"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved" });
  });

  it("returns approved_for_session when user selects session option", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("Yes, for this session"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("returns denied when user selects No", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("returns denied_with_reason when user provides reason", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No, provide reason"),
      input: vi.fn().mockResolvedValue("not now"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "not now",
    });
  });

  it("returns denied when user selects deny-with-reason but gives empty input", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No, provide reason"),
      input: vi.fn().mockResolvedValue(""),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("returns denied when user dismisses dialog (undefined)", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(undefined),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("passes four options to ui.select", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options).toEqual([
      "Yes",
      "Yes, for this session",
      "No",
      "No, provide reason",
    ]);
  });

  it("uses custom sessionLabel when provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message", {
      sessionLabel: 'Yes, allow "git *" for this session',
    });
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe('Yes, allow "git *" for this session');
  });

  it("still returns approved_for_session when user selects the custom session label", async () => {
    const customLabel = 'Yes, allow "git *" for this session';
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(customLabel),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { sessionLabel: customLabel },
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("falls back to default session label when no options provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe("Yes, for this session");
  });
});

describe("requestPermissionDecisionFromUi with timeout", () => {
  it("returns denied_with_reason when timeout fires", async () => {
    const ui: PermissionDecisionUi = {
      // Never resolve — timeout will win the race
      select: vi.fn().mockReturnValue(new Promise(() => {})),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: 1, timeoutDenialReason: "custom timeout reason" },
    );
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "custom timeout reason",
    });
  });

  it("uses default timeout denial message when no custom reason provided", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockReturnValue(new Promise(() => {})),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: 1 },
    );
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Permission request timed out.",
    });
  });

  it("returns normal user decision when user responds before timeout", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("Yes"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: 5000, timeoutDenialReason: "should not fire" },
    );
    expect(result).toEqual({ approved: true, state: "approved" });
  });

  it("ignores timeoutMs: 0 and falls through to user prompt", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: 0, timeoutDenialReason: "should be ignored" },
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("ignores negative timeoutMs", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No, provide reason"),
      input: vi.fn().mockResolvedValue("too risky"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: -1 },
    );
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "too risky",
    });
  });

  it("returns denied_with_reason with timeout reason even when options has no timeoutDenialReason", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockReturnValue(new Promise(() => {})),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { timeoutMs: 1, timeoutDenialReason: "" },
    );
    // Empty string denialReason is normalized to undefined, so fallback to default
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "Permission request timed out.",
    });
  });
});

describe("normalizePermissionDenialReason", () => {
  it("returns trimmed string for non-empty input", () => {
    expect(normalizePermissionDenialReason("  reason  ")).toBe("reason");
  });

  it("returns undefined for empty string", () => {
    expect(normalizePermissionDenialReason("")).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(normalizePermissionDenialReason(42)).toBeUndefined();
  });
});

describe("createDeniedPermissionDecision", () => {
  it("returns denied_with_reason when reason provided", () => {
    expect(createDeniedPermissionDecision("nope")).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "nope",
    });
  });

  it("returns denied when no reason", () => {
    expect(createDeniedPermissionDecision()).toEqual({
      approved: false,
      state: "denied",
    });
  });
});
