import { expect, test } from "vitest";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import { getPermissionSystemStatus } from "#src/status";

test("Permission-system status reflects the current mode", () => {
  expect(getPermissionSystemStatus(DEFAULT_EXTENSION_CONFIG)).toBe("default");
  expect(
    getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, mode: "yolo" }),
  ).toBe("yolo");
  expect(
    getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, mode: "allowEdits" }),
  ).toBe("allowEdits");
});
