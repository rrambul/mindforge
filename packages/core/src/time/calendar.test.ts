import { describe, expect, it } from "vitest";
import {
  activeDaysIn,
  addDays,
  calendarDaysBetween,
  dayBounds,
  dayOfWeek,
  eachDay,
  isIsoDate,
  localDay,
  localHour,
  resolveTimeZone,
  startOfWeek,
  weekDays,
} from "./calendar.js";

/**
 * The zones here are chosen, not sampled. Each one breaks a different shortcut somebody is tempted
 * to take with dates:
 *
 * - **Pacific/Chatham** (+12:45) and **Asia/Kathmandu** (+05:45) break every assumption that offsets
 *   are whole hours.
 * - **Pacific/Kiritimati** (+14:00) is the far end of the range a search window has to bracket.
 * - **America/New_York** transitions at 02:00, so its short and long days are the ordinary case.
 * - **America/Sao_Paulo on 2018-11-04** transitioned *at midnight*: local 00:00 did not happen that
 *   day. This is the case the obvious offset arithmetic gets wrong, and it is historical, so tzdata
 *   will not quietly change it out from under the suite.
 */

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const CHATHAM = "Pacific/Chatham";

describe("resolveTimeZone", () => {
  it("keeps a zone Intl accepts", () => {
    expect(resolveTimeZone(SP)).toBe(SP);
  });

  it("falls back to UTC rather than throwing on a zone that does not exist", () => {
    // profiles.timezone can hold whatever a hand-edited row or an older client put there. The
    // rollup being wrong for one user beats the nightly job dying for the whole batch.
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe("UTC");
  });

  it("falls back on null, undefined, and empty", () => {
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
  });
});

describe("localDay", () => {
  it("reads the date on the wall, not the date in UTC", () => {
    // 02:00Z is still the previous evening in São Paulo. A rollup that bucketed by UTC date would
    // put this session on the wrong day for every user west of Greenwich, every night.
    expect(localDay(new Date("2026-08-07T02:00:00Z"), SP)).toBe("2026-08-06");
    expect(localDay(new Date("2026-08-07T02:00:00Z"), "UTC")).toBe("2026-08-07");
  });

  it("handles the far side of the date line", () => {
    expect(localDay(new Date("2026-08-06T11:00:00Z"), "Pacific/Kiritimati")).toBe("2026-08-07");
  });

  it("handles a three-quarter-hour offset", () => {
    expect(localDay(new Date("2026-08-06T11:20:00Z"), CHATHAM)).toBe("2026-08-07");
    expect(localDay(new Date("2026-08-06T11:10:00Z"), CHATHAM)).toBe("2026-08-06");
  });
});

describe("localHour", () => {
  it("reads the hour on the wall in 24-hour form", () => {
    expect(localHour(new Date("2026-08-07T03:30:00Z"), SP)).toBe(0);
    expect(localHour(new Date("2026-08-07T03:30:00Z"), CHATHAM)).toBe(16);
    expect(localHour(new Date("2026-08-07T23:30:00Z"), "UTC")).toBe(23);
  });
});

describe("isIsoDate", () => {
  it("accepts a real date", () => {
    expect(isIsoDate("2026-08-07")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects a date that matches the shape but does not exist", () => {
    // The one that matters: Date.UTC rolls 2026-02-30 forward to March 2nd rather than failing, so
    // a shape check alone would accept it and every later comparison would be against a date the
    // user never chose.
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2025-02-29")).toBe(false);
  });

  it("rejects anything that is not the shape", () => {
    expect(isIsoDate("2026-8-7")).toBe(false);
    expect(isIsoDate("2026-08-07T00:00:00Z")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(20260807)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});

describe("addDays", () => {
  it("moves forward and back across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-08-07", 0)).toBe("2026-08-07");
  });

  it("moves across a year boundary and a leap day", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("crosses a daylight-saving change without losing or gaining a day", () => {
    // The reason dates are added as dates. Adding 86,400,000ms to an instant here would land on
    // the same calendar day twice, and a 365-cell grid would come out with 366 or 364 cells.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("refuses a string that is not a date", () => {
    expect(() => addDays("yesterday", 1)).toThrow(RangeError);
  });
});

describe("calendarDaysBetween", () => {
  it("counts whole days in both directions", () => {
    expect(calendarDaysBetween("2026-08-01", "2026-08-08")).toBe(7);
    expect(calendarDaysBetween("2026-08-08", "2026-08-01")).toBe(-7);
    expect(calendarDaysBetween("2026-08-07", "2026-08-07")).toBe(0);
  });

  it("counts across a daylight-saving change exactly", () => {
    // A year is 365 days even when two of them were 23 and 25 hours long.
    expect(calendarDaysBetween("2026-01-01", "2027-01-01")).toBe(365);
  });
});

describe("dayOfWeek", () => {
  it("numbers Sunday zero, matching Profile.weekStartsOn", () => {
    expect(dayOfWeek("2026-08-09")).toBe(0);
    expect(dayOfWeek("2026-08-10")).toBe(1);
    expect(dayOfWeek("2026-08-15")).toBe(6);
  });
});

describe("startOfWeek", () => {
  it("finds Monday for a Monday-start week", () => {
    for (const day of weekDays("2026-08-03")) {
      expect(startOfWeek(day, 1)).toBe("2026-08-03");
    }
  });

  it("finds Sunday for a Sunday-start week", () => {
    // pt-BR convention (FR-L5). The same seven days split into two different weeks depending on
    // the profile, which is exactly why the preference is stored rather than derived at render.
    for (const day of weekDays("2026-08-02")) {
      expect(startOfWeek(day, 0)).toBe("2026-08-02");
    }
  });

  it("puts one day in different weeks under the two conventions", () => {
    expect(startOfWeek("2026-08-09", 1)).toBe("2026-08-03");
    expect(startOfWeek("2026-08-09", 0)).toBe("2026-08-09");
  });
});

describe("weekDays", () => {
  it("returns seven consecutive dates starting at the week start", () => {
    expect(weekDays("2026-08-31")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("eachDay", () => {
  it("is inclusive at both ends", () => {
    expect(eachDay("2026-08-07", "2026-08-09")).toEqual(["2026-08-07", "2026-08-08", "2026-08-09"]);
    expect(eachDay("2026-08-07", "2026-08-07")).toEqual(["2026-08-07"]);
  });

  it("returns nothing when the range runs backwards", () => {
    // Rather than throwing: the caller is usually "every day since you last did X", and a user who
    // did X today should get an empty list, not an error.
    expect(eachDay("2026-08-09", "2026-08-07")).toEqual([]);
  });

  it("produces 365 cells for a non-leap year", () => {
    expect(eachDay("2026-01-01", "2026-12-31")).toHaveLength(365);
    expect(eachDay("2024-01-01", "2024-12-31")).toHaveLength(366);
  });
});

describe("dayBounds", () => {
  it("brackets an ordinary day in UTC", () => {
    const { start, end } = dayBounds("2026-08-07", "UTC");
    expect(start.toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  });

  it("brackets an ordinary day in a zone behind UTC", () => {
    const { start, end } = dayBounds("2026-08-07", SP);
    expect(start.toISOString()).toBe("2026-08-07T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-08T03:00:00.000Z");
  });

  it("brackets a day in a three-quarter-hour zone", () => {
    const { start } = dayBounds("2026-08-07", CHATHAM);
    expect(start.toISOString()).toBe("2026-08-06T11:15:00.000Z");
  });

  it("gives a spring-forward day 23 hours and a fall-back day 25", () => {
    const short = dayBounds("2026-03-08", NY);
    const long = dayBounds("2026-11-01", NY);
    expect(short.end.getTime() - short.start.getTime()).toBe(23 * 3600_000);
    expect(long.end.getTime() - long.start.getTime()).toBe(25 * 3600_000);
  });

  it("starts a midnight-gap day at the first instant that day exists", () => {
    // São Paulo, 2018-11-04: the clocks went straight from 23:59 on the 3rd to 01:00 on the 4th, so
    // local midnight never happened. Offset arithmetic converges on 02:00Z here, which still reads
    // as the 3rd — and `dayBounds` would then disagree with `localDay` about which day a session at
    // 02:30Z belongs to. This is the case the bisection exists for.
    const { start } = dayBounds("2018-11-04", SP);
    expect(start.toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(localDay(start, SP)).toBe("2018-11-04");
    expect(localHour(start, SP)).toBe(1);
  });

  it("never returns a start whose own local date is a different day", () => {
    // The invariant the two functions have to share, asserted over every day of a year in four
    // zones rather than at the handful of transitions somebody remembered to look up.
    for (const zone of ["UTC", SP, NY, CHATHAM]) {
      for (const day of eachDay("2026-01-01", "2026-12-31")) {
        const { start, end } = dayBounds(day, zone);
        expect(localDay(start, zone)).toBe(day);
        // One millisecond earlier must be the day before: `start` is the FIRST such instant, not
        // merely some instant during the day.
        expect(localDay(new Date(start.getTime() - 1), zone)).toBe(addDays(day, -1));
        expect(localDay(end, zone)).toBe(addDays(day, 1));
      }
    }
  });
});

describe("activeDaysIn", () => {
  it("counts distinct days inside the window", () => {
    const days = ["2026-08-07", "2026-08-05", "2026-08-01"];
    expect(activeDaysIn(days, "2026-08-07", 28)).toBe(3);
  });

  it("counts a day only once however often it appears", () => {
    expect(activeDaysIn(["2026-08-07", "2026-08-07"], "2026-08-07", 28)).toBe(1);
  });

  it("includes both ends of the window and excludes the day before it", () => {
    // A 28-day window ending on the 7th reaches back to 2026-07-11 inclusive.
    expect(activeDaysIn(["2026-07-11"], "2026-08-07", 28)).toBe(1);
    expect(activeDaysIn(["2026-07-10"], "2026-08-07", 28)).toBe(0);
    expect(activeDaysIn(["2026-08-07"], "2026-08-07", 28)).toBe(1);
  });

  it("excludes days after the window's end", () => {
    // Backdated entry means a session can be logged for tomorrow by mistake. It must not inflate
    // the figure that is supposed to describe the last four weeks.
    expect(activeDaysIn(["2026-08-08"], "2026-08-07", 28)).toBe(0);
  });

  it("is zero for no activity", () => {
    expect(activeDaysIn([], "2026-08-07", 28)).toBe(0);
  });
});
