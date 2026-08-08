import { describe, expect, it } from "vitest";
import { browserTimeZone } from "../../../shared/lib/i18n.js";
import { isKnownTimeZone, supportedTimeZones } from "./timezones.js";

describe("isKnownTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isKnownTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isKnownTimeZone("UTC")).toBe(true);
  });

  it("rejects one the engine does not know", () => {
    // The check is identity against core's resolver, not truthiness: `resolveTimeZone` falls back to
    // UTC rather than throwing, so "Mars/Olympus" would otherwise look like a valid answer of UTC.
    expect(isKnownTimeZone("Mars/Olympus")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
  });
});

describe("supportedTimeZones", () => {
  it("comes from Intl rather than from a list in the repo", () => {
    // A hardcoded list is wrong within a year — Europe/Kyiv was added in 2022.
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("America/Sao_Paulo");
  });

  it("is sorted, because 418 unsorted entries is not a list anybody can scan", () => {
    const zones = supportedTimeZones();
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });

  it("keeps the zone the profile is already set to, even if this engine has never heard of it", () => {
    // Otherwise an account carrying a renamed zone finds its own current setting missing from the
    // values it may be set to, which reads as data loss.
    expect(supportedTimeZones("Mars/Olympus")).toContain("Mars/Olympus");
  });

  it("does not repeat a zone that is already in the list", () => {
    const zones = supportedTimeZones("UTC");
    expect(zones.filter((zone) => zone === "UTC")).toHaveLength(1);
  });
});

describe("browserTimeZone", () => {
  it("answers with something the picker would accept", () => {
    expect(isKnownTimeZone(browserTimeZone())).toBe(true);
  });
});
