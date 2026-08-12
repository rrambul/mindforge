import { describe, expect, it } from "vitest";
import {
  CreateFocusSessionSchema,
  DebriefFocusSessionSchema,
  ENTRY_MODES,
  EntryModeSchema,
  INTENTION_OUTCOMES,
  ListFocusSessionsQuerySchema,
  StartFocusSessionSchema,
  elapsedMinutes,
} from "./focus.js";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("StartFocusSessionSchema", () => {
  it("starts with nothing at all", () => {
    // One tap. Not even the intention is required — a prompt you cannot skip is a prompt
    // that stops you starting.
    expect(StartFocusSessionSchema.parse({})).toEqual({});
  });

  it("takes the one field §5.3 asks at start", () => {
    expect(
      StartFocusSessionSchema.parse({ intention: "  get the parser handling nested groups  " })
        .intention,
    ).toBe("get the parser handling nested groups");
  });

  it("takes a client-generated id, so a replayed start is not a second session", () => {
    expect(StartFocusSessionSchema.parse({ id: UUID }).id).toBe(UUID);
    expect(StartFocusSessionSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });

  it("allows a planned length but never requires one", () => {
    // FR-F1: Pomodoro-style intervals are optional, not mandatory.
    expect(StartFocusSessionSchema.parse({ plannedMinutes: "25" }).plannedMinutes).toBe(25);
    expect(StartFocusSessionSchema.parse({}).plannedMinutes).toBeUndefined();
    expect(StartFocusSessionSchema.safeParse({ plannedMinutes: 0 }).success).toBe(false);
  });

  it("rejects a malformed attachment id rather than passing it to Postgres", () => {
    expect(StartFocusSessionSchema.safeParse({ missionId: "nope" }).success).toBe(false);
    expect(StartFocusSessionSchema.parse({ missionId: null }).missionId).toBeNull();
  });

  it("takes the two modes a live session can start in, and no others", () => {
    // `auto` is the reader timing a lesson while it is open. `manual` and `backfilled`
    // describe a block that is already over and are decided by the server from your own
    // clock — accepting either here would let a client label a *running* session as
    // something entered after the fact.
    expect(StartFocusSessionSchema.parse({ entryMode: "auto" }).entryMode).toBe("auto");
    expect(StartFocusSessionSchema.parse({ entryMode: "timer" }).entryMode).toBe("timer");
    expect(StartFocusSessionSchema.safeParse({ entryMode: "manual" }).success).toBe(false);
    expect(StartFocusSessionSchema.safeParse({ entryMode: "backfilled" }).success).toBe(false);
  });

  it("means timer when it says nothing, so every existing caller keeps its meaning", () => {
    expect(StartFocusSessionSchema.parse({}).entryMode).toBeUndefined();
  });
});

describe("DebriefFocusSessionSchema", () => {
  it("accepts a partial debrief", () => {
    // Every field optional on purpose: a required debrief is one you learn to dismiss, and
    // a dismissed debrief teaches the app that every session was fine.
    expect(DebriefFocusSessionSchema.parse({ hitIntention: "partly" })).toEqual({
      hitIntention: "partly",
    });
    expect(DebriefFocusSessionSchema.parse({ energy: 3 })).toEqual({ energy: 3 });
  });

  it("rejects an empty debrief, which is a mistake rather than an answer", () => {
    expect(DebriefFocusSessionSchema.safeParse({}).success).toBe(false);
  });

  it("takes the three-value outcome, not a five-point scale", () => {
    for (const outcome of INTENTION_OUTCOMES) {
      expect(DebriefFocusSessionSchema.safeParse({ hitIntention: outcome }).success).toBe(true);
    }
    // A 1-5 here would invite averaging yourself into a 3 rather than deciding.
    expect(DebriefFocusSessionSchema.safeParse({ hitIntention: "maybe" }).success).toBe(false);
  });

  it("bounds both ratings to 1-5 integers", () => {
    expect(DebriefFocusSessionSchema.parse({ focusQuality: "4" }).focusQuality).toBe(4);
    expect(DebriefFocusSessionSchema.safeParse({ focusQuality: 0 }).success).toBe(false);
    expect(DebriefFocusSessionSchema.safeParse({ energy: 6 }).success).toBe(false);
    expect(DebriefFocusSessionSchema.safeParse({ energy: 2.5 }).success).toBe(false);
  });
});

describe("CreateFocusSessionSchema", () => {
  it("takes a full session for something you did earlier (FR-F2)", () => {
    const parsed = CreateFocusSessionSchema.parse({
      startedAt: "2026-08-05T09:00:00.000Z",
      endedAt: "2026-08-05T10:30:00.000Z",
      intention: "read chapter 4",
      hitIntention: "yes",
    });
    expect(elapsedMinutes(parsed.startedAt, parsed.endedAt)).toBe(90);
  });

  it("refuses a session that ends before it starts", () => {
    expect(
      CreateFocusSessionSchema.safeParse({
        startedAt: "2026-08-05T10:00:00.000Z",
        endedAt: "2026-08-05T09:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("refuses a zero-length session", () => {
    const instant = "2026-08-05T09:00:00.000Z";
    expect(
      CreateFocusSessionSchema.safeParse({ startedAt: instant, endedAt: instant }).success,
    ).toBe(false);
  });

  it("requires both boundaries, because an entry made after the fact knows them", () => {
    expect(
      CreateFocusSessionSchema.safeParse({ startedAt: "2026-08-05T09:00:00.000Z" }).success,
    ).toBe(false);
  });
});

describe("EntryModeSchema", () => {
  it("distinguishes how the session was recorded", () => {
    // FR-F2: backfilled data must be distinguishable without being second-class. An insight
    // built only on timer sessions describes the days you remembered to press start.
    for (const mode of ENTRY_MODES) {
      expect(EntryModeSchema.safeParse(mode).success).toBe(true);
    }
    expect(EntryModeSchema.safeParse("guessed").success).toBe(false);
  });
});

describe("ListFocusSessionsQuerySchema", () => {
  it("filters by mission and by date", () => {
    const parsed = ListFocusSessionsQuerySchema.parse({
      missionId: UUID,
      since: "2026-08-01T00:00:00.000Z",
    });
    expect(parsed.missionId).toBe(UUID);
    expect(parsed.since).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("accepts no filter at all", () => {
    expect(ListFocusSessionsQuerySchema.parse({})).toEqual({});
  });
});

describe("elapsedMinutes", () => {
  it("rounds down — a session is over when it ends, not when it rounds up", () => {
    const start = new Date("2026-08-05T09:00:00.000Z");
    expect(elapsedMinutes(start, new Date("2026-08-05T09:00:59.000Z"))).toBe(0);
    expect(elapsedMinutes(start, new Date("2026-08-05T09:01:59.000Z"))).toBe(1);
  });

  it("never returns a negative, even with a clock that went backwards", () => {
    // NTP correction mid-session is real, and a negative duration would poison every sum
    // it landed in rather than being visibly wrong.
    const start = new Date("2026-08-05T09:00:00.000Z");
    expect(elapsedMinutes(start, new Date("2026-08-05T08:00:00.000Z"))).toBe(0);
  });
});
