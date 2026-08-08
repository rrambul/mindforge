import {
  addDays,
  backlogHealth,
  buildGrid,
  calendarDaysBetween,
  FRICTION_TYPES,
  localDay,
  resolveTimeZone,
  startOfWeek,
  type ActivityGrid,
  type ActivityGridQuery,
  type BacklogHealth,
  type BacklogQuery,
  type BacklogResource,
  type FrictionSummaryQuery,
  type FrictionType,
  type IsoDate,
  type WeekStart,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import {
  ACTIVITY_GRID_READER,
  type ActivityGridReader,
  type DayRange,
} from "./activity-grid.port.js";
import { BACKLOG_READER, type BacklogReader } from "./backlog.port.js";
import {
  FRICTION_ANALYTICS_READER,
  type FrictionAnalyticsReader,
  type FrictionCell,
} from "./friction-analytics.port.js";
import { PACE_WINDOW_DAYS, plannedDaysPerWeek } from "./planned-days.js";

/**
 * The read-only dashboard (§6's `insights` module, FR-I6b, FR-I7).
 *
 * There is no `domain/` layer under this module, and that is the rule rather than an omission:
 * CLAUDE.md says to add layers when there is an invariant to protect, and nothing here writes
 * anything. The maths that *would* be domain logic already lives in `packages/core` — `buildGrid`,
 * `backlogHealth`, `emberShare` — because the SPA renders the same numbers and non-negotiable 3
 * forbids a second implementation. What is left is fetching, bucketing into the caller's timezone,
 * and deciding honestly what cannot be answered.
 */

/**
 * The two profile settings every insight buckets by (§5.2).
 *
 * Structural, so `RequestContext` satisfies it without the application layer taking a dependency on
 * the shape of an HTTP request.
 */
export interface CalendarSettings {
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

export interface ActivityGridResult {
  readonly grid: ActivityGrid;
  readonly rebuiltAt: Date | null;
}

@Injectable()
export class GetActivityGrid {
  constructor(@Inject(ACTIVITY_GRID_READER) private readonly activity: ActivityGridReader) {}

  async execute(
    userId: string,
    query: ActivityGridQuery,
    settings: CalendarSettings,
  ): Promise<ActivityGridResult> {
    const range: DayRange = { from: query.from, to: query.to };
    const { days, rebuiltAt } = await this.activity.daysIn(userId, range);

    // No timezone conversion here: `daily_activity.day` is already a date in the user's timezone,
    // written that way by the rollup. Re-bucketing it would apply the offset twice.
    return {
      grid: buildGrid(days, {
        ...range,
        layer: query.layer,
        plannedDaysPerWeek: await this.pace(userId, range, days, settings.weekStartsOn),
      }),
      rebuiltAt,
    };
  }

  /**
   * How many days a week the plan in force assumes, or null when it cannot be said honestly.
   *
   * The four-week guard is the important part. `buildGrid`'s signal divides the recent active days
   * by four regardless of how much history it was handed, so answering a seven-day request with a
   * planned figure would produce "your last four weeks average 0.5 active days" from one week of
   * data — a sentence that is wrong and reads as damning. A request that does not span the window
   * gets no plan, and therefore no line.
   */
  private async pace(
    userId: string,
    range: DayRange,
    days: readonly { readonly day: IsoDate; readonly focusMinutes: number }[],
    weekStartsOn: WeekStart,
  ): Promise<number | null> {
    if (calendarDaysBetween(range.from, range.to) < PACE_WINDOW_DAYS - 1) return null;

    const windowFrom = addDays(range.to, -(PACE_WINDOW_DAYS - 1));

    // Only a plan whose week overlaps those same four weeks. A plan from March set beside "your
    // last four weeks" would be two different spans in one sentence, which is how a true-looking
    // line ends up meaning nothing.
    const plannedMinutes = await this.activity.plannedMinutesInForce(userId, {
      from: startOfWeek(windowFrom, weekStartsOn),
      to: startOfWeek(range.to, weekStartsOn),
    });

    return plannedDaysPerWeek(
      plannedMinutes,
      days.filter((day) => day.day >= windowFrom).map((day) => day.focusMinutes),
    );
  }
}

/**
 * Abandonment, which the window cannot see.
 *
 * `resources` records **that** you abandoned something and never **when** — `finished_at` is
 * stamped on finishing and cleared on every other transition, and there is no `abandoned_at`. So an
 * abandonment cannot be placed inside a 28-day window, and `backlogHealth` correctly counts none.
 *
 * Reported here rather than left implicit, because the alternatives are all worse: dating an
 * abandonment from `added_at` would invent a fact, and letting the windowed figures stand alone
 * would publish "0 abandoned, 0% abandonment rate" to a user who quit three books this month — a
 * zero that claims a measurement (non-negotiable 10). The honest fix in the schema is a column, and
 * that is a migration this module does not own.
 */
export interface AbandonmentGap {
  /**
   * Abandoned resources, **all time**.
   *
   * Non-zero means `abandoned`, `resolved` and `netChange` beside it are bounds rather than counts:
   * resolution is under-counted, so queue growth is over-stated by at most this much.
   */
  readonly total: number;
  /** FR-R5's prime friction data, all time for the same reason. Descending by count, then reason. */
  readonly reasons: readonly { readonly reason: string; readonly count: number }[];
}

export interface BacklogInsight extends BacklogHealth {
  readonly abandonment: AbandonmentGap;
  /**
   * Null whenever `abandonment.total` is non-zero, because the numerator is then unknowable.
   *
   * Redeclared with the same type as `BacklogHealth`'s purely to carry this note: the field is the
   * one figure in the response that would otherwise be a confident, false zero.
   */
  readonly abandonmentRate: number | null;
}

@Injectable()
export class GetBacklogHealth {
  constructor(
    @Inject(BACKLOG_READER) private readonly backlog: BacklogReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    query: BacklogQuery,
    settings: CalendarSettings,
  ): Promise<BacklogInsight> {
    const timeZone = resolveTimeZone(settings.timezone);
    const today = localDay(this.clock.now(), timeZone);
    const rows = await this.backlog.listWithLastTouch(userId);

    const resources = rows.map((row): BacklogResource => ({
      id: row.id,
      status: row.status,
      addedOn: localDay(row.addedAt, timeZone),
      resolvedOn: row.finishedAt === null ? null : localDay(row.finishedAt, timeZone),
      abandonReason: row.abandonReason,
      lastTouchedOn: row.lastTouchedAt === null ? null : localDay(row.lastTouchedAt, timeZone),
    }));

    const options = { today, windowDays: query.windowDays };
    const health = backlogHealth(resources, options);
    const abandonment = abandonmentGap(resources);

    return {
      ...health,
      abandonment,
      // abandoned ÷ resolved with an unknowable numerator is not a rate, and 0 would read as "you
      // never quit anything". Null with the count beside it says what is actually known.
      abandonmentRate: abandonment.total === 0 ? health.abandonmentRate : null,
      signal: survivingSignal(health, resources, options),
    };
  }
}

/**
 * `growing` withdrawn when the abandonment gap could be what produced it.
 *
 * `netChange` is an upper bound while abandonments are undated, so the signal might be an artifact
 * of the gap rather than a fact about the queue. Re-running `backlogHealth` with every abandonment
 * placed inside the window — the most favourable case for throughput there is — settles it: if the
 * signal survives, it holds no matter when they actually happened.
 *
 * Re-running rather than subtracting a threshold here on purpose. Core owns "how much growth is
 * worth a sentence", and a copy of that number in this file is a second definition that would drift
 * (non-negotiable 3). `stalling` and `aging` are untouched — neither reads a resolution date.
 */
function survivingSignal(
  health: BacklogHealth,
  resources: readonly BacklogResource[],
  options: { readonly today: IsoDate; readonly windowDays: number },
): BacklogHealth["signal"] {
  if (health.signal?.kind !== "growing") return health.signal;

  const optimistic = backlogHealth(
    resources.map((r) => (r.status === "abandoned" ? { ...r, resolvedOn: options.today } : r)),
    options,
  );
  return optimistic.signal?.kind === "growing" ? health.signal : null;
}

function abandonmentGap(resources: readonly BacklogResource[]): AbandonmentGap {
  const counts = new Map<string, number>();
  let total = 0;

  for (const resource of resources) {
    if (resource.status !== "abandoned") continue;
    total += 1;
    // The reason is optional (FR-R5) — requiring one turns quitting into a confession — so an
    // abandonment with nothing to say contributes to the total and to no reason.
    if (resource.abandonReason === null) continue;
    counts.set(resource.abandonReason, (counts.get(resource.abandonReason) ?? 0) + 1);
  }

  return {
    total,
    reasons: [...counts]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
  };
}

export interface FrictionTypeCount {
  /** A key. The UI translates it at render (§5.2). */
  readonly type: FrictionType;
  readonly count: number;
  /** Mean intensity over this type's events, 1–5, to one decimal. */
  readonly meanIntensity: number;
}

export interface MissionFrictionCount {
  readonly missionId: string;
  readonly topic: string;
  readonly count: number;
}

/**
 * Friction with no mission behind it, split by *why* it has none.
 *
 * Two different facts wearing the same word, and the distinction is the actionable one: friction
 * you log outside any session says the capture bar is reaching you between blocks, while friction
 * inside sessions you never attached to a mission says the picker is being skipped.
 */
export interface UnattributedFriction {
  readonly total: number;
  /** Logged outside any session — the standalone tap FR-C1 exists for. */
  readonly standalone: number;
  /** Logged in a session that was never attached to a mission. */
  readonly sessionWithoutMission: number;
}

/**
 * What the weekly review needs and `/friction/summary` does not answer (FR-I6b, §6).
 *
 * The summary gives the ember/slag split and counts by type. This adds the half the review turns
 * on: *where* the friction was. Friction rows carry no `mission_id` — mission is reachable only
 * through `focus_sessions` — so a standalone tap genuinely has no mission, and those are reported
 * as unattributed rather than dropped from the totals or filed under a mission they never had.
 */
export interface FrictionAnalytics {
  readonly eventCount: number;
  readonly byType: readonly FrictionTypeCount[];
  readonly byMission: readonly MissionFrictionCount[];
  readonly unattributed: UnattributedFriction;
}

@Injectable()
export class GetFrictionAnalytics {
  constructor(
    @Inject(FRICTION_ANALYTICS_READER) private readonly friction: FrictionAnalyticsReader,
  ) {}

  async execute(userId: string, query: FrictionSummaryQuery): Promise<FrictionAnalytics> {
    return fold(await this.friction.crossTab(userId, query));
  }
}

interface TypeTotal {
  count: number;
  intensitySum: number;
}

function fold(cells: readonly FrictionCell[]): FrictionAnalytics {
  const types = new Map<FrictionType, TypeTotal>();
  const missions = new Map<string, MissionFrictionCount>();
  let eventCount = 0;
  let standalone = 0;
  let sessionWithoutMission = 0;

  for (const cell of cells) {
    eventCount += cell.count;

    const total = types.get(cell.type) ?? { count: 0, intensitySum: 0 };
    total.count += cell.count;
    total.intensitySum += cell.intensitySum;
    types.set(cell.type, total);

    if (cell.missionId === null) {
      standalone += cell.standaloneCount;
      sessionWithoutMission += cell.count - cell.standaloneCount;
      continue;
    }

    const mission = missions.get(cell.missionId);
    if (mission === undefined) {
      // The topic is carried through so the review screen can name the mission without a second
      // round trip per row — the whole point of the endpoint is the sentence "tooling, on Rust".
      missions.set(cell.missionId, {
        missionId: cell.missionId,
        topic: cell.missionTopic ?? "",
        count: cell.count,
      });
    } else {
      missions.set(cell.missionId, { ...mission, count: mission.count + cell.count });
    }
  }

  return {
    eventCount,
    byType: [...types]
      .map(([type, total]) => ({
        type,
        count: total.count,
        // One decimal. Two would imply a precision that a 1–5 tap does not have.
        meanIntensity: Math.round((total.intensitySum / total.count) * 10) / 10,
      }))
      // Ties broken by the taxonomy's own order rather than alphabetically. `avoidance` sorting
      // above `tooling` because of its first letter is the trap that has bitten this codebase twice,
      // and it would put a rare type at the top of "your biggest friction sources".
      .sort(
        (a, b) =>
          b.count - a.count || FRICTION_TYPES.indexOf(a.type) - FRICTION_TYPES.indexOf(b.type),
      ),
    byMission: [...missions.values()].sort(
      (a, b) =>
        b.count - a.count ||
        a.topic.localeCompare(b.topic) ||
        a.missionId.localeCompare(b.missionId),
    ),
    unattributed: { total: standalone + sessionWithoutMission, standalone, sessionWithoutMission },
  };
}
