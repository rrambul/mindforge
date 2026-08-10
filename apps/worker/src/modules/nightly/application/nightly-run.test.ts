import { FixedClock, type IsoDate } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { NightlyRun } from "./nightly-run.js";
import type { NightlyGateway, NightlyProfile } from "./nightly.port.js";

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

  readonly rollups: RollCall[] = [];
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
      // A retroactive entry lands on a day that was already rolled up. Touching only yesterday
      // would leave those days wrong forever.
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

  describe("failure handling", () => {
    it("keeps going when one profile blows up", async () => {
      // A hand-edited row must not cost every other user their grid.
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
      expect(await run.execute()).toEqual({ profilesSeen: 1, rolledUp: 0, failures: 0 });
    });
  });
});
