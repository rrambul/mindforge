import { describe, expect, it } from "vitest";
import { compareVersions, unseenCount } from "./version.js";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("sorts a prerelease below its release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  it("ignores build metadata, which SemVer says carries no precedence", () => {
    expect(compareVersions("1.0.0+abc123", "1.0.0")).toBe(0);
  });

  it("refuses to order something that is not a version", () => {
    // Treating it as 0.0.0 would make one typo in the changelog announce every release as new.
    expect(compareVersions("unreleased", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "")).toBe(0);
  });
});

describe("unseenCount", () => {
  it("counts every release when the changelog has never been opened", () => {
    // Null is "never opened", which is a different state from "up to date" (§14.1).
    expect(unseenCount(["0.2.0", "0.1.0"], null)).toBe(2);
  });

  it("counts nothing when the newest release is the one already seen", () => {
    expect(unseenCount(["0.2.0", "0.1.0"], "0.2.0")).toBe(0);
  });

  it("counts only what came after", () => {
    expect(unseenCount(["0.3.0", "0.2.0", "0.1.0"], "0.1.0")).toBe(2);
  });

  it("shows nothing when the stored version is ahead of the build", () => {
    // A rollback leaves this state, and `newest !== seen` would then show a dot forever — pointing at
    // an entry that does not exist. A marker that is sometimes wrong is one you stop reading.
    expect(unseenCount(["0.2.0"], "0.3.0")).toBe(0);
  });
});
