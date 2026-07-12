import { describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPermissionForwardingNonce,
  isForwardedPermissionResponseBoundToRequest,
  safeEqualString,
} from "#src/permission-forwarding";
import { readForwardedPermissionResponse } from "#src/forwarded-permissions/io";

describe("createPermissionForwardingNonce", () => {
  test("returns a string", () => {
    const nonce = createPermissionForwardingNonce();
    expect(typeof nonce).toBe("string");
  });

  test("returns base64url encoded string", () => {
    const nonce = createPermissionForwardingNonce();
    // base64url uses A-Z, a-z, 0-9, -, _
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("returns 43 characters for 32 bytes (base64url without padding)", () => {
    const nonce = createPermissionForwardingNonce();
    // 32 bytes = 256 bits → base64url = ceil(32 * 4/3) = 43 chars (no padding)
    expect(nonce.length).toBe(43);
  });

  test("generates unique nonces", () => {
    const nonces = new Set(
      Array.from({ length: 100 }, () => createPermissionForwardingNonce()),
    );
    // All 100 should be unique
    expect(nonces.size).toBe(100);
  });
});

describe("safeEqualString", () => {
  test("returns true for identical strings", () => {
    expect(safeEqualString("hello", "hello")).toBe(true);
  });

  test("returns true for identical long strings", () => {
    const s = "a".repeat(1000);
    expect(safeEqualString(s, s)).toBe(true);
  });

  test("returns false for different strings of same length", () => {
    expect(safeEqualString("hello", "world")).toBe(false);
  });

  test("returns false for strings of different length", () => {
    expect(safeEqualString("hello", "hello world")).toBe(false);
    expect(safeEqualString("", "a")).toBe(false);
  });

  test("returns true for empty strings", () => {
    expect(safeEqualString("", "")).toBe(true);
  });

  test("is timing-safe (returns false quickly for different-length strings)", () => {
    // This is a behavioral test - we can't truly test timing safety,
    // but we verify the function works correctly for the edge case
    expect(safeEqualString("a", "b".repeat(1000))).toBe(false);
  });
});

describe("isForwardedPermissionResponseBoundToRequest", () => {
  test("returns true when nonces match and session IDs match", () => {
    const request = {
      responseNonce: "test-nonce-123",
      targetSessionId: "session-abc",
    };
    const response = {
      responseNonce: "test-nonce-123",
      responderSessionId: "session-abc",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      true,
    );
  });

  test("returns false when nonces do not match", () => {
    const request = {
      responseNonce: "nonce-request",
      targetSessionId: "session-abc",
    };
    const response = {
      responseNonce: "nonce-forged",
      responderSessionId: "session-abc",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      false,
    );
  });

  test("returns false when session IDs do not match", () => {
    const request = {
      responseNonce: "test-nonce",
      targetSessionId: "session-abc",
    };
    const response = {
      responseNonce: "test-nonce",
      responderSessionId: "session-evil",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      false,
    );
  });

  test("returns false when response has no nonce but request does", () => {
    const request = {
      responseNonce: "test-nonce",
      targetSessionId: "session-abc",
    };
    const response = {
      responseNonce: undefined,
      responderSessionId: "session-abc",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      false,
    );
  });

  test("skips nonce verification when request has no nonce (version-skew)", () => {
    const request = {
      responseNonce: undefined,
      targetSessionId: "session-abc",
    };
    const response = {
      responseNonce: undefined,
      responderSessionId: "session-abc",
    };
    // Should still verify session ID
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      true,
    );
  });

  test("returns false when session IDs are empty or null", () => {
    const request = {
      responseNonce: "test-nonce",
      targetSessionId: "",
    };
    const response = {
      responseNonce: "test-nonce",
      responderSessionId: "",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      false,
    );
  });

  test("returns false when both nonces and sessions mismatch", () => {
    const request = {
      responseNonce: "nonce-a",
      targetSessionId: "session-a",
    };
    const response = {
      responseNonce: "nonce-b",
      responderSessionId: "session-b",
    };
    expect(isForwardedPermissionResponseBoundToRequest(request, response)).toBe(
      false,
    );
  });
});

describe("responseNonce round-trip via readForwardedPermissionResponse", () => {
  test("preserves responseNonce when writing and reading a response file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nonce-rt-"));
    try {
      const filePath = join(tmpDir, "response.json");
      const nonce = createPermissionForwardingNonce();
      const writtenData = {
        approved: true,
        state: "approved" as const,
        responderSessionId: "session-abc",
        respondedAt: Date.now(),
        responseNonce: nonce,
      };
      writeFileSync(filePath, JSON.stringify(writtenData), "utf-8");

      const result = readForwardedPermissionResponse(null, filePath);
      expect(result).not.toBeNull();
      expect(result!.responseNonce).toBe(nonce);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("responseNonce is undefined when not present in the response file", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nonce-rt-"));
    try {
      const filePath = join(tmpDir, "response.json");
      // Simulate older version that doesn't write responseNonce
      const writtenData = {
        approved: true,
        state: "approved" as const,
        responderSessionId: "session-abc",
        respondedAt: Date.now(),
      };
      writeFileSync(filePath, JSON.stringify(writtenData), "utf-8");

      const result = readForwardedPermissionResponse(null, filePath);
      expect(result).not.toBeNull();
      expect(result!.responseNonce).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("round-trip binding: write → read → isForwardedPermissionResponseBoundToRequest", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nonce-rt-"));
    try {
      const filePath = join(tmpDir, "response.json");
      const nonce = createPermissionForwardingNonce();

      // Simulate the full parent-session write path
      const request = {
        responseNonce: nonce,
        targetSessionId: "session-parent",
      };

      const responseData = {
        approved: true,
        state: "approved" as const,
        responderSessionId: "session-parent",
        respondedAt: Date.now(),
        responseNonce: nonce,
      };
      writeFileSync(filePath, JSON.stringify(responseData), "utf-8");

      // Child reads the response
      const readResponse = readForwardedPermissionResponse(null, filePath);
      expect(readResponse).not.toBeNull();

      // Child verifies nonce binding
      expect(
        isForwardedPermissionResponseBoundToRequest(request, readResponse!),
      ).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
