import { addDays, localDay, localHour, type Clock, type IsoDate } from "@mindforge/core";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK } from "../../../shared/clock.js";
import { NIGHTLY_GATEWAY, type NightlyGateway, type NightlyProfile } from "./nightly.port.js";

/**
 * The nightly run: the `daily_activity` rollup (§10).
 *
 * **Everything is driven by the user's local clock, not by a UTC hour.** §10 is explicit —
 * a "day" that rolls over at 4pm local is a bug — so the scheduler wakes often and this decides,
 * per profile, whether anything is due for *them*. That is also why it takes a `Clock` rather than
 * reading one: a job that cannot be run at a fixed instant in a test is a job whose only feedback
 * loop is production at 3am.
 */

/**
 * How far back each rollup reaches.
 *
 * Eight days rather than yesterday alone: a retroactive session entry lands on a day that was
 * already rolled up, and a rollup that only touched yesterday would leave it wrong permanently.
 */
const ROLLUP_WINDOW_DAYS = 8;

/**
 * The earliest local hour the day's work may run.
 *
 * Late enough that a session finished at 1am belongs to the day being rolled up rather than arriving
 * after it, and early enough to be done before anyone looks. Not midnight: the day boundary is
 * exactly where a session is most likely to still be running.
 */
const RUN_AFTER_LOCAL_HOUR = 3;

export interface NightlyOutcome {
  readonly profilesSeen: number;
  readonly rolledUp: number;
  readonly failures: number;
}

@Injectable()
export class NightlyRun {
  private readonly logger = new Logger(NightlyRun.name);

  /**
   * The local day each user's daily work last ran for, kept in memory rather than in a table.
   *
   * Deliberate, and it has one visible consequence worth knowing: on boot the map is empty, so the
   * first tick after a restart runs the day's work for everyone. That is the behaviour you want —
   * a worker that was down overnight catches up on start — and the cost of the pathological case, a
   * worker restarting hourly, is a redundant rollup over eight days. The rollup is idempotent, so
   * redundant is all it is. A table would buy nothing except a table.
   */
  private readonly lastRunDay = new Map<string, IsoDate>();

  constructor(
    @Inject(NIGHTLY_GATEWAY) private readonly gateway: NightlyGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(): Promise<NightlyOutcome> {
    const now = this.clock.now();
    const profiles = await this.gateway.listProfiles();

    let rolledUp = 0;
    let failures = 0;

    for (const profile of profiles) {
      try {
        rolledUp += await this.forProfile(profile, now);
      } catch (error) {
        // One bad profile must not take the batch down. A hand-edited row, a timezone Intl has
        // since dropped — the other users' grids are still owed their rebuild, and a job that dies
        // on the first exception is a job that silently stops working for everyone the day one
        // user's data goes strange.
        failures += 1;
        this.logger.error(
          `Nightly run failed for ${profile.userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { profilesSeen: profiles.length, rolledUp, failures };
  }

  private async forProfile(profile: NightlyProfile, now: Date): Promise<number> {
    const today = localDay(now, profile.timezone);
    const hour = localHour(now, profile.timezone);

    const alreadyRan = this.lastRunDay.get(profile.userId) === today;
    if (alreadyRan || hour < RUN_AFTER_LOCAL_HOUR) return 0;

    await this.gateway.rollUp(profile.userId, profile.timezone, {
      from: addDays(today, -(ROLLUP_WINDOW_DAYS - 1)),
      to: today,
    });

    this.lastRunDay.set(profile.userId, today);
    return 1;
  }
}
