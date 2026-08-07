import { describe, expect, it } from "vitest";
import {
  defaultNotificationPrefs,
  NOTIFICATION_KINDS,
  NotificationPrefSchema,
  StallConfigSchema,
  UpdateNotificationPrefsSchema,
  WeeklyReviewConfigSchema,
} from "./notification.js";

describe("NotificationPrefSchema", () => {
  it("defaults every kind to on", () => {
    // "Quiet by default" (FR-N4) is a delivery decision, not an off switch. Read as
    // off-until-enabled the feature ships dead: nobody turns on notifications they have never seen.
    for (const kind of NOTIFICATION_KINDS) {
      expect(NotificationPrefSchema.parse({ kind }).enabled).toBe(true);
    }
  });

  it("defaults the weekly review to Sunday evening", () => {
    // The review is about the week that just ended. Monday morning competes with the one starting.
    expect(NotificationPrefSchema.parse({ kind: "weekly_review" })).toEqual({
      kind: "weekly_review",
      enabled: true,
      config: { weekday: 0, hour: 18 },
    });
  });

  it("defaults stall detection to FR-N3's own twelve days", () => {
    expect(NotificationPrefSchema.parse({ kind: "stall" })).toEqual({
      kind: "stall",
      enabled: true,
      config: { afterDays: 12 },
    });
  });

  it("refuses one kind's config against the other", () => {
    // The discriminated union is what stops a jsonb column becoming a junk drawer.
    expect(
      NotificationPrefSchema.safeParse({ kind: "stall", config: { weekday: 0, hour: 18 } }).success,
    ).toBe(false);
    expect(
      NotificationPrefSchema.safeParse({ kind: "weekly_review", config: { afterDays: 12 } })
        .success,
    ).toBe(false);
  });

  it("refuses a kind nothing knows how to render", () => {
    expect(NotificationPrefSchema.safeParse({ kind: "surprise" }).success).toBe(false);
  });

  it("can be switched off", () => {
    expect(NotificationPrefSchema.parse({ kind: "stall", enabled: false }).enabled).toBe(false);
  });
});

describe("WeeklyReviewConfigSchema", () => {
  it("bounds the weekday and the hour", () => {
    expect(WeeklyReviewConfigSchema.safeParse({ weekday: 7, hour: 9 }).success).toBe(false);
    expect(WeeklyReviewConfigSchema.safeParse({ weekday: -1, hour: 9 }).success).toBe(false);
    expect(WeeklyReviewConfigSchema.safeParse({ weekday: 6, hour: 24 }).success).toBe(false);
    expect(WeeklyReviewConfigSchema.parse({ weekday: 6, hour: 23 })).toEqual({
      weekday: 6,
      hour: 23,
    });
  });
});

describe("StallConfigSchema", () => {
  it("refuses a threshold that would nag", () => {
    // Two days without a session is a weekend, not a stall.
    expect(StallConfigSchema.safeParse({ afterDays: 2 }).success).toBe(false);
    expect(StallConfigSchema.safeParse({ afterDays: 3 }).success).toBe(true);
    expect(StallConfigSchema.safeParse({ afterDays: 91 }).success).toBe(false);
  });
});

describe("UpdateNotificationPrefsSchema", () => {
  it("accepts every kind at once and no more", () => {
    const prefs = NOTIFICATION_KINDS.map((kind) => ({ kind }));
    expect(UpdateNotificationPrefsSchema.parse({ prefs }).prefs).toHaveLength(prefs.length);
    expect(
      UpdateNotificationPrefsSchema.safeParse({ prefs: [...prefs, { kind: "stall" }] }).success,
    ).toBe(false);
  });
});

describe("defaultNotificationPrefs", () => {
  it("is every kind, on, at its defaults", () => {
    // What a profile with no rows behaves as, so a lazy read never has to invent one.
    const prefs = defaultNotificationPrefs();
    expect(prefs.map((p) => p.kind)).toEqual([...NOTIFICATION_KINDS]);
    expect(prefs.every((p) => p.enabled)).toBe(true);
  });
});
