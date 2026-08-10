import type { GridCell } from "@mindforge/core";
import { describe, expect, it } from "vitest";
import { intensityOpacity, leadingOffset, monthMarkers } from "./heatmap.js";

function cells(from: string, count: number): GridCell[] {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    value: 0,
    intensity: 0,
    emberShare: null,
  }));
}

describe("leadingOffset", () => {
  it("puts a Monday on the first row of a week that starts on Monday", () => {
    // 2026-08-03 is a Monday.
    expect(leadingOffset("2026-08-03", 1)).toBe(0);
  });

  it("puts the same Monday one row down when the week starts on Sunday", () => {
    // The offset is what aligns a year of cells; getting it wrong shifts every square by a day and
    // nothing about the rendering makes that visible.
    expect(leadingOffset("2026-08-03", 0)).toBe(1);
  });

  it("puts a Sunday last in a Monday-first week", () => {
    expect(leadingOffset("2026-08-09", 1)).toBe(6);
  });
});

describe("monthMarkers", () => {
  it("places a label above the column its first day falls in", () => {
    // From Monday 2026-08-03: 29 days reaches 2026-08-31, and September 1st is the 30th cell.
    const markers = monthMarkers(cells("2026-08-03", 40), 1);

    expect(markers).toEqual([{ day: "2026-09-01", column: 5 }]);
  });

  it("skips a month whose first day lands in the leading partial column", () => {
    // A label at column one would sit on top of the axis's own start, and the range begins
    // mid-month by construction — the year ends today, wherever today is.
    const markers = monthMarkers(cells("2026-09-01", 20), 0);

    expect(markers).toEqual([]);
  });

  it("has nothing to say about an empty range", () => {
    expect(monthMarkers([], 1)).toEqual([]);
  });
});

describe("intensityOpacity", () => {
  it("gives the lightest step real presence, so 'a little' is not 'nothing'", () => {
    expect(intensityOpacity(1)).toBeGreaterThan(0.2);
  });

  it("rises with intensity and tops out opaque", () => {
    expect(intensityOpacity(4)).toBe(1);
    expect(intensityOpacity(3)).toBeLessThan(intensityOpacity(4));
    expect(intensityOpacity(1)).toBeLessThan(intensityOpacity(2));
  });

  it("draws nothing for an empty day", () => {
    expect(intensityOpacity(0)).toBe(0);
  });
});
