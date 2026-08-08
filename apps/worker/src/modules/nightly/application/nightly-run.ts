import {
  addDays,
  dayOfWeek,
  detectStalls,
  localDay,
  localHour,
  StallPayloadSchema,
  startOfWeek,
  WeeklyReviewPayloadSchema,
  type Clock,
  type IsoDate,
  type StallConfig,
  type WeeklyReviewConfig,
} from "@mindforge/core";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK } from "../../../shared/clock.js";
import {
  NIGHTLY_GATEWAY,
  type NightlyGateway,
  type NightlyProfile,
  type RaisedNotification,
} from "./nightly.port.js";

/**
 * The nightly run: the rollup, stall detection, and the weekly-review reminder (§10).
 *
 * **Everything is driven by the user's local clock, not by a UTC hour.** §10 is explicit —
 * "a daily review queue that rolls over at 4pm local is a bug" — so the scheduler wakes often and
 * this decides, per profile, whether anything is due for *them*. That is also why it takes a `Clock`
 * rather than reading one: a job that cannot be run at a fixed instant in a test is a job whose only
 * feedback loop is production at 3am.
 *
 * **Nothing here checks whether a notification already exists.** The dedupe key does, in Postgres,
 * through a unique index — so two ticks racing cannot both win, and a restart mid-run cannot double
 * up. A check-then-insert would look equivalent and be wrong under exactly the conditions a
 * scheduler produces.
 */

/** How far back each rollup reaches. */
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
  readonly notificationsRaised: number;
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
   * worker restarting hourly, is a redundant rollup over eight days. Both jobs are idempotent, so
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
    let notificationsRaised = 0;
    let failures = 0;

    for (const profile of profiles) {
      try {
        const outcome = await this.forProfile(profile, now);
        rolledUp += outcome.rolledUp;
        notificationsRaised += outcome.raised;
      } catch (error) {
        // One bad profile must not take the batch down. A hand-edited row, a timezone Intl has
        // since dropped, a mission deleted mid-run — the other users' grids are still owed their
        // rebuild, and a job that dies on the first exception is a job that silently stops working
        // for everyone the day one user's data goes strange.
        failures += 1;
        this.logger.error(
          `Nightly run failed for ${profile.userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { profilesSeen: profiles.length, rolledUp, notificationsRaised, failures };
  }

  private async forProfile(
    profile: NightlyProfile,
    now: Date,
  ): Promise<{ rolledUp: number; raised: number }> {
    const today = localDay(now, profile.timezone);
    const hour = localHour(now, profile.timezone);

    // The weekly reminder is checked on every tick, because it is due at an hour the user chose
    // rather than at the start of their day. Its dedupe key stops it repeating.
    const raised = await this.raiseWeeklyReviewReminder(profile, today, hour);

    const alreadyRan = this.lastRunDay.get(profile.userId) === today;
    if (alreadyRan || hour < RUN_AFTER_LOCAL_HOUR) {
      return { rolledUp: 0, raised };
    }

    await this.gateway.rollUp(profile.userId, profile.timezone, {
      from: addDays(today, -(ROLLUP_WINDOW_DAYS - 1)),
      to: today,
    });

    const stallsRaised = await this.raiseStalls(profile, today);
    this.lastRunDay.set(profile.userId, today);

    return { rolledUp: 1, raised: raised + stallsRaised };
  }

  /**
   * The rollup reaches back eight days rather than rebuilding yesterday alone.
   *
   * §9.3 classifies `too_hard` by whether the session produced learning, and the debrief that
   * decides it is often written the next morning — sometimes several mornings later. A rollup that
   * only touched yesterday would leave those days wrong permanently, and the number it would leave
   * wrong is the product's headline one.
   */

  private async raiseStalls(profile: NightlyProfile, today: IsoDate): Promise<number> {
    const pref = await this.prefFor(profile.userId, "stall");
    if (pref === null) return 0;

    const config = pref.config as StallConfig;
    const candidates = await this.gateway.stallCandidates(profile.userId, profile.timezone);
    const stalls = detectStalls(candidates, { today, afterDays: config.afterDays });
    if (stalls.length === 0) return 0;

    const topics = await this.gateway.missionTopics(
      profile.userId,
      stalls.map((stall) => stall.missionId),
    );

    const notifications: RaisedNotification[] = stalls.flatMap((stall) => {
      const topic = topics.get(stall.missionId);
      // A mission whose topic cannot be read is one that was deleted between the two queries. Skip
      // it rather than raise a nudge that renders as a blank name and links nowhere.
      if (topic === undefined) return [];
      return [
        {
          userId: profile.userId,
          kind: "stall" as const,
          dedupeKey: stall.dedupeKey,
          // Built through the shared schema, not by hand. This wrote `{ topic, untouchedDays }`
          // while the SPA read `missionTopic` — so every nudge rendered "a mission has gone quiet"
          // and lost the one thing FR-N3 exists to say, with both suites green because each
          // asserted its own spelling. Arguments, not a sentence: the SPA renders the message in
          // the user's own locale (§5.2), and English baked into this row could never be read in
          // pt-BR.
          payload: StallPayloadSchema.parse({ missionTopic: topic, days: stall.untouchedDays }),
          subjectType: "mission",
          subjectId: stall.missionId,
        },
      ];
    });

    return this.gateway.raise(notifications);
  }

  private async raiseWeeklyReviewReminder(
    profile: NightlyProfile,
    today: IsoDate,
    hour: number,
  ): Promise<number> {
    const pref = await this.prefFor(profile.userId, "weekly_review");
    if (pref === null) return 0;

    const config = pref.config as WeeklyReviewConfig;
    if (dayOfWeek(today) !== config.weekday || hour < config.hour) return 0;

    // Keyed on the week the review is *about*, which is the one ending today — not on today, so a
    // reminder is not re-raised if the user changes their preferred day mid-week.
    const weekStart = startOfWeek(today, profile.weekStartsOn);

    return this.gateway.raise([
      {
        userId: profile.userId,
        kind: "weekly_review",
        dedupeKey: `weekly_review:${weekStart}`,
        payload: WeeklyReviewPayloadSchema.parse({ weekStart }),
        subjectType: null,
        subjectId: null,
      },
    ]);
  }

  /** The enabled pref of a kind, or null when the user has switched it off. */
  private async prefFor(
    userId: string,
    kind: "weekly_review" | "stall",
  ): Promise<{ config: unknown } | null> {
    const prefs = await this.gateway.notificationPrefs(userId);
    const pref = prefs.find((candidate) => candidate.kind === kind);
    return pref === undefined || !pref.enabled ? null : pref;
  }
}
