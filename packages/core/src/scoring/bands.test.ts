import { describe, expect, it } from "vitest";
import { BANDS, bandFor, bandIndex, compareBands, featherFor } from "./bands.js";

const NOW = new Date("2026-08-05T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("bandFor", () => {
  it("returns null for an unproven skill rather than the lowest band", () => {
    // "No evidence" is not "barely aware" — the gauge must show neither.
    expect(bandFor(null)).toBeNull();
  });

  it.each([
    [0, "aware"],
    [24.99, "aware"],
    [25, "assisted"],
    [49.99, "assisted"],
    [50, "working"],
    [69.99, "working"],
    [70, "fluent"],
    [89.99, "fluent"],
    [90, "teaching"],
    [100, "teaching"],
  ])("maps %s to %s", (score, expected) => {
    expect(bandFor(score)).toBe(expected);
  });

  it("floors a negative score into the lowest band", () => {
    expect(bandFor(-10)).toBe("aware");
  });
});

describe("band ordering", () => {
  it("indexes bands from least to most proven", () => {
    expect(bandIndex("aware")).toBe(0);
    expect(bandIndex("teaching")).toBe(BANDS.length - 1);
  });

  it("compares bands by rank", () => {
    expect(compareBands("fluent", "working")).toBeGreaterThan(0);
    expect(compareBands("aware", "teaching")).toBeLessThan(0);
    expect(compareBands("working", "working")).toBe(0);
  });
});

describe("featherFor", () => {
  it("is vague when nothing has ever been proven", () => {
    expect(featherFor(null, NOW)).toBe("vague");
  });

  it("is crisp within a week of evidence", () => {
    expect(featherFor(daysAgo(0), NOW)).toBe("crisp");
    expect(featherFor(daysAgo(6.9), NOW)).toBe("crisp");
  });

  it("softens after a week", () => {
    expect(featherFor(daysAgo(7), NOW)).toBe("soft");
    expect(featherFor(daysAgo(59), NOW)).toBe("soft");
  });

  it("goes vague after two months", () => {
    expect(featherFor(daysAgo(60), NOW)).toBe("vague");
    expect(featherFor(daysAgo(400), NOW)).toBe("vague");
  });
});
