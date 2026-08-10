import { dayBounds, elapsedMinutes, localDay, type IsoDate } from "@mindforge/core";
import type { PrismaClient } from "../generated/client/client.js";

/**
 * The `daily_activity` rollup (FR-Q2, §10's `insights:rollup`).
 *
 * **Why this is in `packages/db` and not in `apps/worker`.** It has three callers and they cannot
 * share code any other way: the nightly job in the worker, `seed:rich` (which has to produce six
 * months of grid before any of it can be designed), and eventually a manual rebuild. The worker
 * cannot import `apps/api`, `apps/api` is not a package, and the aggregation is a database query
 * rather than domain maths — so the package that owns database access owns it.
 *
 * **Why a stored derivation is allowed here at all.** CLAUDE.md's second idea is that derived
 * numbers are computed on read and never stored, and this table is a stored derivation. The
 * exemption is narrow and stated: `daily_activity` is a **cache**, never authoritative. Nothing
 * reads it to make a decision, nothing writes to it except this function, and it can be rebuilt from
 * raw rows at any moment — which is what `rebuildRange` over a whole year is. The alternative is
 * scanning every session to draw 365 cells, which is the query that makes an activity grid
 * something you stop opening.
 *
 * **Why it re-runs over recent days rather than only yesterday.** A retroactive session entry lands
 * on a day that has already been rolled up — a rollup that only ever touched yesterday would leave
 * those days wrong forever.
 *
 * **Why every query filters `user_id` by hand.** The worker connects with the service-role key,
 * which bypasses RLS entirely by design (§3.6). That makes the explicit filter the only thing
 * standing between one user's grid and another's — CLAUDE.md's first non-negotiable.
 */

export interface RollupResult {
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Days that had something on them. The rest are deleted rather than written as zeroes. */
  readonly daysWritten: number;
}

interface DayAccumulator {
  focusMinutes: number;
  sessionCount: number;
}

/**
 * Rebuild `[from, to]` inclusive for one user, in their timezone.
 *
 * Delete-then-insert inside one transaction rather than upsert-per-day. A session deleted since the
 * last run has to make its day's numbers go *down*, and an upsert can only ever revise a day
 * upwards — the stale row for a day that is now empty would survive forever. Deleting the range
 * first makes the rollup idempotent in both directions, which is what lets the nightly job be
 * re-run, restarted, or fired twice by a daylight-saving repeat without double counting.
 *
 * `now` is passed in rather than read: `rebuiltAt` is the only thing that distinguishes a stale grid
 * from an empty one, and a job that cannot be tested at a fixed time is a job that fails at midnight.
 */
export async function rebuildDailyActivity(
  prisma: PrismaClient,
  userId: string,
  timeZone: string,
  range: { readonly from: IsoDate; readonly to: IsoDate },
  now: Date,
): Promise<RollupResult> {
  const windowStart = dayBounds(range.from, timeZone).start;
  const windowEnd = dayBounds(range.to, timeZone).end;

  const sessions = await prisma.focusSession.findMany({
    where: { userId, startedAt: { gte: windowStart, lt: windowEnd } },
    select: { startedAt: true, endedAt: true },
  });

  const byDay = new Map<IsoDate, DayAccumulator>();

  for (const session of sessions) {
    // A session belongs to the day it STARTED. One running from 23:30 to 00:30 is one evening's
    // work, and splitting its minutes across two cells would make both of them wrong about what
    // happened — a 20-minute Tuesday that was really the tail of Monday night.
    const key = localDay(session.startedAt, timeZone);
    let day = byDay.get(key);
    if (day === undefined) {
      day = { focusMinutes: 0, sessionCount: 0 };
      byDay.set(key, day);
    }

    day.sessionCount += 1;
    day.focusMinutes +=
      session.endedAt === null ? 0 : elapsedMinutes(session.startedAt, session.endedAt);
  }

  const rows = [...byDay]
    // Sessions are found by their start instant, so one that began just before the window and ran
    // into it can land on a day outside the range. Writing it would revise a day this rebuild has
    // not measured — its other sessions were never loaded.
    .filter(([day]) => day >= range.from && day <= range.to)
    .map(([day, acc]) => ({
      userId,
      day: new Date(`${day}T00:00:00.000Z`),
      focusMinutes: acc.focusMinutes,
      sessionCount: acc.sessionCount,
      rebuiltAt: now,
    }));

  await prisma.$transaction([
    prisma.dailyActivity.deleteMany({
      where: {
        userId,
        day: {
          gte: new Date(`${range.from}T00:00:00.000Z`),
          lte: new Date(`${range.to}T00:00:00.000Z`),
        },
      },
    }),
    prisma.dailyActivity.createMany({ data: rows }),
  ]);

  return { from: range.from, to: range.to, daysWritten: rows.length };
}
