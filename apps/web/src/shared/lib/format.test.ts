import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatInstant,
  formatMinutes,
  formatMonth,
  formatPercent,
  formatWeekday,
} from "./format.js";

describe("formatDay", () => {
  it("names the day the IsoDate says, not the one the browser's zone would make of it", () => {
    // The regression this exists to prevent: an IsoDate is already a wall date in the user's own
    // calendar, so putting it through a timezone a second time moves half the grid a day left.
    expect(formatDay("2026-03-14", "en")).toBe("Sat, Mar 14, 2026");
  });

  it("spells it the locale's way", () => {
    expect(formatDay("2026-03-14", "pt-BR")).toContain("14 de mar.");
  });
});

describe("formatMonth", () => {
  it("gives the axis a short month", () => {
    expect(formatMonth("2026-03-01", "en")).toBe("Mar");
  });
});

describe("formatInstant", () => {
  it("puts a real instant in the profile's timezone", () => {
    // 03:00 UTC is midnight in São Paulo, and the rollup timestamp is the one figure on the screen
    // that genuinely is an instant rather than a date.
    expect(formatInstant("2026-03-14T03:00:00.000Z", "en", "America/Sao_Paulo")).toContain(
      "12:00 AM",
    );
  });
});

describe("formatWeekday", () => {
  it("names the weekday by number, 0 being Sunday", () => {
    expect(formatWeekday(0, "en")).toBe("Sunday");
    expect(formatWeekday(6, "en")).toBe("Saturday");
  });

  it("translates", () => {
    expect(formatWeekday(6, "pt-BR")).toBe("sábado");
  });
});

describe("formatMinutes", () => {
  it("reads as hours and minutes", () => {
    expect(formatMinutes(135, "en")).toBe("2 hr 15 min");
  });

  it("uses the locale's own unit names rather than a hardcoded h and m", () => {
    expect(formatMinutes(135, "pt-BR")).toBe("2 h 15 min");
  });

  it("drops the hours when there are none", () => {
    expect(formatMinutes(45, "en")).toBe("45 min");
  });

  it("says zero rather than nothing at all", () => {
    // This is a cell label. An empty duration reads as a rendering failure.
    expect(formatMinutes(0, "en")).toBe("0 min");
  });

  it("omits a zero minute remainder on a whole hour", () => {
    expect(formatMinutes(120, "en")).toBe("2 hr");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percent, because a share to one decimal implies precision", () => {
    expect(formatPercent(0.7449, "en")).toBe("74%");
  });
});
