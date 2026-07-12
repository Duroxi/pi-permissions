import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock node:os so tilde-expansion is deterministic across platforms.
vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

// Mock node:fs so realpathSync (used by canonicalizePath) is controllable.
// Default implementation is identity — lexical assertions are unaffected.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", () => ({
  realpathSync,
  default: { realpathSync },
}));

import { PathNormalizer } from "#src/path-normalizer";

describe("PathNormalizer", () => {
  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  describe("posix flavor", () => {
    const normalizer = new PathNormalizer("linux", "/projects/my-app");

    test("forPath builds an AccessPath resolved against the baked cwd", () => {
      const ap = normalizer.forPath("src/foo.ts");
      expect(ap.value()).toBe("/projects/my-app/src/foo.ts");
      expect(ap.matchValues()).toEqual([
        "/projects/my-app/src/foo.ts",
        "src/foo.ts",
      ]);
    });

    test("forPath honors an explicit resolveBase", () => {
      const ap = normalizer.forPath("foo.ts", {
        resolveBase: "/projects/my-app/sub",
      });
      expect(ap.value()).toBe("/projects/my-app/sub/foo.ts");
    });

    test("forLiteral builds a literal-only AccessPath", () => {
      const ap = normalizer.forLiteral("foo.ts");
      expect(ap.matchValues()).toEqual(["foo.ts"]);
      expect(ap.boundaryValue()).toBe("");
    });

    test("isAbsolute uses posix rules", () => {
      expect(normalizer.isAbsolute("/etc/hosts")).toBe(true);
      expect(normalizer.isAbsolute("rel/path")).toBe(false);
    });

    test("resolveBase resolves an offset against the baked cwd", () => {
      expect(normalizer.resolveBase("sub")).toBe("/projects/my-app/sub");
      expect(normalizer.resolveBase("/abs")).toBe("/abs");
    });

    test("joinBase joins an offset with a relative target", () => {
      expect(normalizer.joinBase("sub", "nested")).toBe("sub/nested");
    });

    test("isWithinDirectory decides containment", () => {
      expect(normalizer.isWithinDirectory("/a/b/c", "/a/b")).toBe(true);
      expect(normalizer.isWithinDirectory("/a/x", "/a/b")).toBe(false);
    });

    test("isOutsideWorkingDirectory tests against the baked cwd", () => {
      expect(normalizer.isOutsideWorkingDirectory("/projects/my-app/src")).toBe(
        false,
      );
      expect(normalizer.isOutsideWorkingDirectory("/etc/hosts")).toBe(true);
    });

    test("isOutsideWorkingDirectory expands a home-relative token", () => {
      expect(normalizer.isOutsideWorkingDirectory("~/secrets")).toBe(true);
    });

    test("isOutsideWorkingDirectory resolves a relative token inside cwd", () => {
      expect(normalizer.isOutsideWorkingDirectory("src/index.ts")).toBe(false);
    });

    test("isOutsideWorkingDirectory follows an in-cwd symlink to an external target", () => {
      // ./link -> /etc: realpathSync resolves the full token in one call.
      realpathSync.mockImplementation((p: string) => {
        if (p === "/projects/my-app/link/hosts") return "/etc/hosts";
        return p;
      });
      expect(normalizer.isOutsideWorkingDirectory("./link/hosts")).toBe(true);
    });

    test("isOutsideWorkingDirectory keeps a path inside a symlinked cwd", () => {
      // /tmp -> /private/tmp on macOS; cwd reported as the resolved /private/tmp.
      realpathSync.mockImplementation((p: string) => {
        if (p.startsWith("/tmp/")) return `/private/tmp${p.slice(4)}`;
        if (p === "/tmp") return "/private/tmp";
        return p;
      });
      const symlinkNormalizer = new PathNormalizer("linux", "/private/tmp");
      expect(
        symlinkNormalizer.isOutsideWorkingDirectory("/tmp/workspace/file.ts"),
      ).toBe(false);
    });

    test("comparableValue returns the lexical absolute form (no FS)", () => {
      expect(normalizer.comparableValue("src/foo.ts")).toBe(
        "/projects/my-app/src/foo.ts",
      );
      expect(normalizer.comparableValue("/etc/hosts")).toBe("/etc/hosts");
    });
  });

  describe("win32 flavor", () => {
    const normalizer = new PathNormalizer("win32", "C:\\Projects\\App");

    test("forPath builds a case-folded AccessPath with win32 rules", () => {
      const ap = normalizer.forPath("src\\foo.ts");
      expect(ap.value()).toBe("c:\\projects\\app\\src\\foo.ts");
      expect(ap.matchValues()).toEqual([
        "c:\\projects\\app\\src\\foo.ts",
        "src\\foo.ts",
      ]);
    });

    test("isAbsolute uses win32 rules", () => {
      expect(normalizer.isAbsolute("C:\\Users\\foo")).toBe(true);
      expect(normalizer.isAbsolute("rel\\path")).toBe(false);
    });

    test("resolveBase resolves an offset against the baked cwd", () => {
      expect(normalizer.resolveBase("sub")).toBe("C:\\Projects\\App\\sub");
    });

    test("joinBase joins an offset with a relative target", () => {
      expect(normalizer.joinBase("sub", "nested")).toBe("sub\\nested");
    });

    test("isWithinDirectory folds case", () => {
      expect(
        normalizer.isWithinDirectory(
          "c:\\users\\foo\\dir\\sub",
          "C:\\Users\\Foo\\dir",
        ),
      ).toBe(true);
    });

    test("isOutsideWorkingDirectory case-folds against the baked cwd", () => {
      expect(
        normalizer.isOutsideWorkingDirectory("c:\\projects\\app\\src"),
      ).toBe(false);
      expect(normalizer.isOutsideWorkingDirectory("C:\\Other\\dir")).toBe(true);
    });

    test("comparableValue case-folds the lexical absolute form", () => {
      expect(normalizer.comparableValue("src\\foo.ts")).toBe(
        "c:\\projects\\app\\src\\foo.ts",
      );
    });
  });

  describe("isInfrastructureRead", () => {
    const normalizer = new PathNormalizer("linux", "/projects/my-app");

    test("allows a read-only tool targeting a configured infra dir", () => {
      const ap = normalizer.forPath("/infra/git/pkg/SKILL.md");
      expect(normalizer.isInfrastructureRead("read", ap, ["/infra"])).toBe(
        true,
      );
    });

    test("does not allow a write tool targeting an infra dir", () => {
      const ap = normalizer.forPath("/infra/git/pkg/file.ts");
      expect(normalizer.isInfrastructureRead("write", ap, ["/infra"])).toBe(
        false,
      );
    });

    test("does not allow a read-only tool outside any infra dir", () => {
      const ap = normalizer.forPath("/elsewhere/file.ts");
      expect(normalizer.isInfrastructureRead("read", ap, ["/infra"])).toBe(
        false,
      );
    });

    test("allows a read targeting the project-local .pi/npm dir (from baked cwd)", () => {
      const ap = normalizer.forPath("/projects/my-app/.pi/npm/dep/index.js");
      expect(normalizer.isInfrastructureRead("read", ap, [])).toBe(true);
    });
  });
});
