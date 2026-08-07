import {
  defaultNotificationPrefs,
  FixedClock,
  type IsoDate,
  type NotificationPref,
  type StallCandidate,
} from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { NightlyRun } from "./nightly-run.js";
import type { NightlyGateway, NightlyProfile, RaisedNotification } from "./nightly.port.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

/** 2026-08-09 is a Sunday. In São Paulo (UTC−3) this instant reads 06:00 local. */
const SUNDAY_MORNING = new Date("2026-08-09T09:00:00Z");
const SP = "America/Sao_Paulo";

interface RollCall {
  readonly userId: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

class FakeGateway implements NightlyGateway {
  profiles: NightlyProfile[] = [{ userId: ALICE, timezone: SP, weekStartsOn: 0 }];
  candidates = new Map<string, StallCandidate[]>();
  topics = new Map<string, string>();
  prefs = new Map<string, NotificationPref[]>();
  /** Dedupe keys already taken, standing in for the unique index. */
  existing = new Set<string>();

  readonly rollups: RollCall[] = [];
  readonly raised: RaisedNotification[] = [];
  failFor: string | null = null;

  listProfiles(): Promise<readonly NightlyProfile[]> {
    return Promise.resolve(this.profiles);
  }

  rollUp(
    userId: string,
    _timezone: string,
    range: { readonly from: IsoDate; readonly to: IsoDate },
  ): Promise<{ readonly daysWritten: number }> {
    if (this.failFor === userId) return Promise.reject(new Error("rollup exploded"));
    this.rollups.push({ userId, from: range.from, to: range.to });
    return Promise.resolve({ daysWritten: 1 });
  }

  stallCandidates(userId: string): Promise<readonly StallCandidate[]> {
    return Promise.resolve(this.candidates.get(userId) ?? []);
  }

  missionTopics(
    _userId: string,
    missionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(
      new Map(
        missionIds.flatMap((id) => {
          const topic = this.topics.get(id);
          return topic === undefined ? [] : [[id, topic] as const];
        }),
      ),
    );
  }

  notificationPrefs(userId: string): Promise<readonly NotificationPref[]> {
    return Promise.resolve(this.prefs.get(userId) ?? defaultNotificationPrefs());
  }

  raise(notifications: readonly RaisedNotification[]): Promise<number> {
    let count = 0;
    for (const notification of notifications) {
      const key = `${notification.userId}:${notification.dedupeKey}`;
      if (this.existing.has(key)) continue;
      this.existing.add(key);
      this.raised.push(notification);
      count += 1;
    }
    return Promise.resolve(count);
  }
}

describe("NightlyRun", () => {
  let gateway: FakeGateway;
  let clock: FixedClock;
  let run: NightlyRun;

  beforeEach(() => {
    gateway = new FakeGateway();
    clock = new FixedClock(SUNDAY_MORNING);
    run = new NightlyRun(gateway, clock);
  });

  describe("the rollup", () => {
    it("rebuilds a trailing window, not yesterday alone", () => {
      // A debrief written days later changes whether a session's `too_hard` was productive, and the
      // day's ember share with it. Touching only yesterday would leave those days wrong forever.
      return run.execute().then(() => {
        expect(gateway.rollups).toEqual([{ userId: ALICE, from: "2026-08-02", to: "2026-08-09" }]);
      });
    });

    it("buckets the window in each user's timezone, not the server's", async () => {
      // One instant, two users, two different local days — which is the whole reason §10 forbids a
      // global UTC hour. 13:00Z is already 03:00 on the 10th at +14 and still 10:00 on the 9th at
      // −3, so a UTC-bucketed rollup would put one of them on the wrong day every single night.
      gateway.profiles = [
        { userId: ALICE, timezone: "Pacific/Kiritimati", weekStartsOn: 1 },
        { userId: BOB, timezone: SP, weekStartsOn: 1 },
      ];
      clock.set(new Date("2026-08-09T13:00:00Z"));

      await run.execute();
      expect(gateway.rollups).toEqual([
        { userId: ALICE, from: "2026-08-03", to: "2026-08-10" },
        { userId: BOB, from: "2026-08-02", to: "2026-08-09" },
      ]);
    });

    it("waits until the small hours have passed in that user's day", async () => {
      // Not midnight: the day boundary is exactly when a session is most likely to still be running.
      clock.set(new Date("2026-08-09T04:00:00Z")); // 01:00 in São Paulo
      await run.execute();
      expect(gateway.rollups).toEqual([]);
    });

    it("runs once a day, not once a tick", async () => {
      await run.execute();
      clock.advance(15 * 60 * 1000);
      await run.execute();
      clock.advance(6 * 60 * 60 * 1000);
      await run.execute();
      expect(gateway.rollups).toHaveLength(1);
    });

    it("runs again once the user's own day has rolled over", async () => {
      await run.execute();
      clock.advance(24 * 60 * 60 * 1000);
      await run.execute();
      expect(gateway.rollups.map((r) => r.to)).toEqual(["2026-08-09", "2026-08-10"]);
    });

    it("catches up on the first tick after a restart", async () => {
      // The in-memory day map is empty on boot, which is the behaviour a worker that was down
      // overnight needs. Modelled here as a fresh instance.
      await run.execute();
      const afterRestart = new NightlyRun(gateway, clock);
      await afterRestart.execute();
      expect(gateway.rollups).toHaveLength(2);
    });
  });

  describe("stall detection", () => {
    beforeEach(() => {
      // A Monday morning, deliberately. The dedupe key buckets by Monday-anchored week, so a test
      // that started on a Sunday and advanced a day would cross a bucket boundary and look like a
      // deduplication failure when it is the designed behaviour.
      clock.set(new Date("2026-08-10T12:00:00Z")); // 09:00 in São Paulo
      gateway.candidates.set(ALICE, [
        { missionId: "m1", createdOn: "2026-01-01", lastSessionOn: "2026-07-01" },
        { missionId: "m2", createdOn: "2026-01-01", lastSessionOn: "2026-08-09" },
      ]);
      gateway.topics.set("m1", "Writing that people finish");
      gateway.topics.set("m2", "Rust, properly");
    });

    it("raises one nudge for the quiet mission and none for the busy one", async () => {
      await run.execute();
      const stalls = gateway.raised.filter((n) => n.kind === "stall");
      expect(stalls).toHaveLength(1);
      expect(stalls[0]).toMatchObject({
        userId: ALICE,
        subjectType: "mission",
        subjectId: "m1",
        payload: { topic: "Writing that people finish", untouchedDays: 40 },
      });
    });

    it("carries arguments rather than a sentence", () => {
      // The SPA renders the `stall` message key in the user's own locale (§5.2). English baked into
      // this row could never be read in pt-BR.
      return run.execute().then(() => {
        const payload = gateway.raised.find((n) => n.kind === "stall")!.payload;
        expect(Object.keys(payload).sort()).toEqual(["topic", "untouchedDays"]);
      });
    });

    it("does not re-raise the same stall the next day", async () => {
      await run.execute();
      clock.advance(24 * 60 * 60 * 1000);
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "stall")).toHaveLength(1);
    });

    it("asks again the following week", async () => {
      // A mission quiet for a month should ask once a week, not thirty times and not once ever.
      // The dedupe key is bucketed rather than permanent precisely so this happens.
      await run.execute();
      clock.advance(7 * 24 * 60 * 60 * 1000);
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "stall")).toHaveLength(2);
    });

    it("skips a mission whose topic vanished between the two queries", async () => {
      // Deleted mid-run. A nudge with a blank name that links nowhere is worse than no nudge.
      gateway.topics.delete("m1");
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "stall")).toHaveLength(0);
    });

    it("stays silent when the user has switched it off", async () => {
      gateway.prefs.set(ALICE, [
        { kind: "stall", enabled: false, config: { afterDays: 12 } },
        { kind: "weekly_review", enabled: false, config: { weekday: 0, hour: 18 } },
      ]);
      await run.execute();
      expect(gateway.raised).toEqual([]);
    });

    it("honours a configured threshold", async () => {
      gateway.prefs.set(ALICE, [
        { kind: "stall", enabled: true, config: { afterDays: 90 } },
        { kind: "weekly_review", enabled: false, config: { weekday: 0, hour: 18 } },
      ]);
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "stall")).toHaveLength(0);
    });
  });

  describe("the weekly review reminder", () => {
    it("fires on the configured weekday once the hour has come", async () => {
      // Default is Sunday at 18:00. 09:00Z is 06:00 in São Paulo, so it is too early.
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "weekly_review")).toHaveLength(0);

      clock.set(new Date("2026-08-09T21:30:00Z")); // 18:30 in São Paulo
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "weekly_review")).toHaveLength(1);
    });

    it("is keyed on the week it is about, not on the day it fired", async () => {
      clock.set(new Date("2026-08-09T21:30:00Z"));
      await run.execute();
      // weekStartsOn 0, so the week containing Sunday the 9th begins that same day.
      expect(gateway.raised.find((n) => n.kind === "weekly_review")).toMatchObject({
        dedupeKey: "weekly_review:2026-08-09",
        payload: { weekStart: "2026-08-09" },
        subjectType: null,
      });
    });

    it("does not repeat later the same evening", async () => {
      clock.set(new Date("2026-08-09T21:30:00Z"));
      await run.execute();
      clock.advance(60 * 60 * 1000);
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "weekly_review")).toHaveLength(1);
    });

    it("does not fire on the wrong weekday", async () => {
      clock.set(new Date("2026-08-10T21:30:00Z")); // Monday evening in São Paulo
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "weekly_review")).toHaveLength(0);
    });

    it("is checked before the small-hours gate, since its hour is the user's choice", async () => {
      // A user who asks to be reminded at 01:00 must be reminded at 01:00, not held until 03:00.
      gateway.prefs.set(ALICE, [
        { kind: "weekly_review", enabled: true, config: { weekday: 0, hour: 1 } },
        { kind: "stall", enabled: false, config: { afterDays: 12 } },
      ]);
      clock.set(new Date("2026-08-09T04:30:00Z")); // 01:30 in São Paulo
      await run.execute();
      expect(gateway.raised.filter((n) => n.kind === "weekly_review")).toHaveLength(1);
      expect(gateway.rollups).toEqual([]);
    });
  });

  describe("failure handling", () => {
    it("keeps going when one profile blows up", async () => {
      // A hand-edited row or a mission deleted mid-run must not cost every other user their grid.
      gateway.profiles = [
        { userId: ALICE, timezone: SP, weekStartsOn: 0 },
        { userId: BOB, timezone: SP, weekStartsOn: 1 },
      ];
      gateway.failFor = ALICE;

      const outcome = await run.execute();
      expect(outcome).toMatchObject({ profilesSeen: 2, rolledUp: 1, failures: 1 });
      expect(gateway.rollups.map((r) => r.userId)).toEqual([BOB]);
    });

    it("does not record the day as done for a profile that failed", async () => {
      // Otherwise a transient error costs that user their rollup until tomorrow.
      gateway.failFor = ALICE;
      await run.execute();
      gateway.failFor = null;
      await run.execute();
      expect(gateway.rollups).toHaveLength(1);
    });

    it("reports what it did", async () => {
      await run.execute();
      expect(await run.execute()).toEqual({
        profilesSeen: 1,
        rolledUp: 0,
        notificationsRaised: 0,
        failures: 0,
      });
    });
  });
});
