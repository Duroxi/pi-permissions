import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDiscoverGlobalNodeModulesRoot } = vi.hoisted(() => ({
  mockDiscoverGlobalNodeModulesRoot: vi.fn<() => string | null>(),
}));

vi.mock("../src/node-modules-discovery", () => ({
  discoverGlobalNodeModulesRoot: mockDiscoverGlobalNodeModulesRoot,
}));

import { getGlobalLogsDir } from "#src/config-paths";
import { computeExtensionPaths } from "#src/extension-paths";
import { resolve as _resolve } from "node:path";
const _p = (s) => { const r = _resolve(s); return process.platform === "win32" ? r.toLowerCase() : r; };

describe("computeExtensionPaths", () => {
  beforeEach(() => {
    mockDiscoverGlobalNodeModulesRoot.mockReset();
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(
      "/mock/global/node_modules",
    );
  });

  it("sets agentDir from argument", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.agentDir).toBe(_p("/test/agent"));
  });

  it("derives sessionsDir as agentDir/sessions", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.sessionsDir).toBe(_p("/test/agent/sessions"));
  });

  it("derives subagentSessionsDir as agentDir/subagent-sessions", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.subagentSessionsDir).toBe(_p("/test/agent/subagent-sessions"));
  });

  it("derives forwardingDir as sessionsDir/permission-forwarding", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.forwardingDir).toBe(
      join(_p("/test/agent"), "sessions", "permission-forwarding"),
    );
  });

  it("derives globalLogsDir via getGlobalLogsDir(agentDir)", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.globalLogsDir).toBe(getGlobalLogsDir(_p("/test/agent")));
  });

  it("includes agentDir in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.piInfrastructureDirs).toContain(_p("/test/agent"));
  });

  it("includes agentDir/git in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.piInfrastructureDirs).toContain(_p("/test/agent/git"));
  });

  it("includes discovered global node_modules root in piInfrastructureDirs", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    // Mock returns raw string, added to array without join
    expect(paths.piInfrastructureDirs).toContain("/mock/global/node_modules");
  });

  it("omits global node_modules from piInfrastructureDirs when discovery returns null", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.piInfrastructureDirs).toHaveLength(2);
    expect(paths.piInfrastructureDirs).toContain(_p("/test/agent"));
    expect(paths.piInfrastructureDirs).toContain(_p("/test/agent/git"));
  });

  it("all entries in piInfrastructureDirs are strings (no null)", () => {
    mockDiscoverGlobalNodeModulesRoot.mockReturnValue(null);
    const paths = computeExtensionPaths(_p("/test/agent"));
    for (const dir of paths.piInfrastructureDirs) {
      expect(typeof dir).toBe("string");
    }
  });

  it("includes piPackageDir in piInfrastructureDirs when provided", () => {
    const paths = computeExtensionPaths("/test/agent", "/pi/install");
    // piPackageDir is added to array directly without path operations
    expect(paths.piInfrastructureDirs).toContain("/pi/install");
  });

  it("omits piPackageDir when not provided (current behavior preserved)", () => {
    const paths = computeExtensionPaths(_p("/test/agent"));
    expect(paths.piInfrastructureDirs).toEqual([
      _p("/test/agent"),
      _p("/test/agent/git"),
      "/mock/global/node_modules",
    ]);
  });

  it("omits piPackageDir when given an empty string", () => {
    const paths = computeExtensionPaths("/test/agent", "");
    expect(paths.piInfrastructureDirs).not.toContain("");
  });

  it("two calls with different agentDirs produce independent results", () => {
    const a = computeExtensionPaths(_p("/agent/a"));
    const b = computeExtensionPaths(_p("/agent/b"));
    expect(a.agentDir).toBe(_p("/agent/a"));
    expect(b.agentDir).toBe(_p("/agent/b"));
    expect(a.sessionsDir).toBe(_p("/agent/a/sessions"));
    expect(b.sessionsDir).toBe(_p("/agent/b/sessions"));
  });
});
