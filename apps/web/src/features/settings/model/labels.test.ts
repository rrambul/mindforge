import { describe, expect, it } from "vitest";
import { hourLabel, releaseDateLabel, weekdayLabels, zoneTimeLabel } from "./labels.js";

describe("weekdayLabels", () => {
  it("starts at Sunday, matching the stored value", () => {
    // 0 = Sunday in `Profile.weekStartsOn` and in `notification_prefs.config.weekday`. An off-by-one
    // here would schedule the weekly review on the wrong day and look perfectly reasonable.
    expect(weekdayLabels("en")[0]).toBe("Sunday");
    expect(weekdayLabels("en")[6]).toBe("Saturday");
  });

  it("is the platform's vocabulary, not the bundle's", () => {
    expect(weekdayLabels("pt-BR")[0]).toMatch(/domingo/iu);
  });
});

describe("hourLabel", () => {
  it("writes the hour the way the locale writes hours", () => {
    // Not `hour12` forced either way: which convention a language uses is what Intl is for, and
    // hardcoding one ships an American clock to a Brazilian interface.
    expect(hourLabel("en", 18)).toMatch(/6/u);
    expect(hourLabel("en", 18)).toMatch(/PM/iu);
    expect(hourLabel("pt-BR", 18)).toMatch(/18/u);
  });

  it("handles midnight without wrapping to the previous day", () => {
    expect(hourLabel("en", 0)).toMatch(/12/u);
  });
});

describe("zoneTimeLabel", () => {
  const instant = new Date("2026-08-07T12:00:00Z");

  it("says what time it is in the zone being picked", () => {
    // São Paulo is UTC-3 in August.
    expect(zoneTimeLabel("en", "America/Sao_Paulo", instant)).toMatch(/9/u);
  });

  it("answers null for a zone the engine does not know", () => {
    // Null rather than a thrown error: the picker renders this while you are still typing.
    expect(zoneTimeLabel("en", "Mars/Olympus", instant)).toBeNull();
  });
});

describe("releaseDateLabel", () => {
  it("formats a release date in the reader's locale", () => {
    expect(releaseDateLabel("en", "2026-08-07")).toMatch(/2026/u);
    expect(releaseDateLabel("pt-BR", "2026-08-07")).toMatch(/2026/u);
  });

  it("does not shift the date into the reader's timezone", () => {
    // A calendar date, not an instant. Formatted locally, a release would land a day earlier for
    // every reader west of Greenwich.
    expect(releaseDateLabel("en", "2026-08-07")).toMatch(/7/u);
  });

  it("has nothing to say about a release with no date", () => {
    // An entry written before release-please dated its heading. Not 1 January 1970.
    expect(releaseDateLabel("en", null)).toBeNull();
    expect(releaseDateLabel("en", "not-a-date")).toBeNull();
  });
});
