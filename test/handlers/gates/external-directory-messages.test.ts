import { describe, expect, test } from "vitest";

import {
  formatBashExternalDirectoryAskPrompt,
  formatExternalDirectoryAskPrompt,
} from "#src/handlers/gates/external-directory-messages";

// Denial message functions (formatExternalDirectoryDenyReason,
// formatExternalDirectoryUserDeniedReason, formatExternalDirectoryHardStopHint,
// formatBashExternalDirectoryDenyReason) have moved to denial-messages.ts.

describe("formatExternalDirectoryAskPrompt", () => {
  test("formats external directory access message", () => {
    const result = formatExternalDirectoryAskPrompt(
      "read",
      "/etc/passwd",
      undefined,
      "/projects/my-app",
    );
    expect(result).toBe("External directory access: /etc/passwd");
  });

  test("formats external directory access for write tool", () => {
    const result = formatExternalDirectoryAskPrompt(
      "write",
      "/tmp/out.txt",
      undefined,
      "/projects/my-app",
    );
    expect(result).toBe("External directory access: /tmp/out.txt");
  });

  test("formats external directory access with resolved path", () => {
    const result = formatExternalDirectoryAskPrompt(
      "read",
      "/etc/passwd",
      "/etc/passwd_real",
      "/projects/my-app",
    );
    // Compact format does not include resolved path info.
    expect(result).toBe("External directory access: /etc/passwd");
    expect(result).not.toContain("resolves to");
  });
});

describe("formatBashExternalDirectoryAskPrompt", () => {
  test("formats bash external directory access message", () => {
    const result = formatBashExternalDirectoryAskPrompt(
      "cat /etc/passwd",
      [{ path: "/etc/passwd" }],
      "/projects/my-app",
    );
    expect(result).toBe("Bash external directory access: cat /etc/passwd");
  });

  test("formats bash external directory access with multiple external paths", () => {
    const result = formatBashExternalDirectoryAskPrompt(
      "diff /etc/hosts /var/log/syslog",
      [{ path: "/etc/hosts" }, { path: "/var/log/syslog" }],
      "/projects/my-app",
    );
    expect(result).toBe(
      "Bash external directory access: diff /etc/hosts /var/log/syslog",
    );
  });
});
