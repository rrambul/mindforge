import {
  addDays,
  backlogHealth,
  buildGrid,
  detectStalls,
  localDay,
  type ActivityDay,
} from "@mindforge/core";
import { connect, parseOptions } from "./seed-support.js";

/**
 * What the seeded account actually looks like to the insight functions.
 *
 * `seed:rich` can report "180 days, 101 sessions" and still have produced a screen where every
 * derived line is null, every grid cell is the same shade, and no signal has ever fired — which is
 * the one shape that proves nothing and is exactly what a naive random seed produces. This runs the
 * real `packages/core` functions over the seeded rows and prints what they say, so "the fixture is
 * designable" is a thing you can check rather than a thing you hope.
 *
 * It caught two real gaps the first time it ran: every abandonment was months outside the 28-day
 * window, so the abandonment rate and reasons list were permanently empty; and all three active
 * missions had recent sessions, so stall detection never fired. Both were fixed in the fixture.
 */

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const prisma = connect();

  try {
    const [profile] = await prisma.$queryRawUnsafe<{ id: string; timezone: string }[]>(
      `select p.id, p.timezone from profiles p join auth.users u on u.id = p.id where u.email = $1`,
      options.email,
    );
    if (!profile) {
      throw new Error(`No account for ${options.email}. Run seed:rich first.`);
    }

    const tz = profile.timezone;
    const today = options.today;
    const out: string[] = [`${options.email} — ${tz}, through ${today}`];

    const rows = await prisma.dailyActivity.findMany({
      where: { userId: profile.id },
      orderBy: { day: "asc" },
    });
    const days: ActivityDay[] = rows.map((row) => ({
      day: row.day.toISOString().slice(0, 10),
      focusMinutes: row.focusMinutes,
      emberMinutes: row.emberMinutes,
      slagMinutes: row.slagMinutes,
      notesCaptured: row.notesCaptured,
    }));

    const grid = buildGrid(days, { from: addDays(today, -179), to: today });
    const spread = [0, 1, 2, 3, 4]
      .map((step) => `${step}:${grid.cells.filter((c) => c.intensity === step).length}`)
      .join("  ");

    out.push(
      "",
      "activity grid",
      `  cells ${grid.cells.length}, of which ${grid.cells.filter((c) => c.intensity > 0).length} have something on them`,
      `  intensity  ${spread}`,
      // Days with focus but no friction are the case that contributes to neither ember nor slag.
      // A fixture without them lets a screen quietly assume every active day has a hue.
      `  hue on ${grid.cells.filter((c) => c.emberShare !== null).length} cells, absent on ${grid.cells.filter((c) => c.intensity > 0 && c.emberShare === null).length} active ones`,
      `  active days in 28: ${grid.activeDaysIn28}`,
      `  signal: ${describe(grid.signal)}`,
    );

    const resources = await prisma.resource.findMany({
      where: { userId: profile.id },
      select: {
        id: true,
        title: true,
        status: true,
        addedAt: true,
        finishedAt: true,
        abandonReason: true,
        sessions: { select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 },
      },
    });
    const backlog = backlogHealth(
      resources.map((resource) => ({
        id: resource.title,
        status: resource.status,
        addedOn: localDay(resource.addedAt, tz),
        resolvedOn: resource.finishedAt === null ? null : localDay(resource.finishedAt, tz),
        abandonReason: resource.abandonReason,
        lastTouchedOn:
          resource.sessions[0] === undefined ? null : localDay(resource.sessions[0].startedAt, tz),
      })),
      { today },
    );

    out.push(
      "",
      "backlog health",
      `  ${backlog.openCount} open, oldest ${backlog.oldestOpenDays ?? "—"}d, median ${backlog.medianOpenAgeDays ?? "—"}d`,
      `  window: +${backlog.added} added, −${backlog.resolved} resolved (${backlog.finished} finished, ${backlog.abandoned} abandoned)`,
      `  abandonment rate: ${backlog.abandonmentRate === null ? "—" : `${Math.round(backlog.abandonmentRate * 100)}%`}`,
      `  reasons: ${backlog.abandonReasons.map((r) => `${r.reason}×${r.count}`).join(", ") || "—"}`,
      `  stalled: ${backlog.stalled.map((s) => `${s.id} (${s.untouchedDays}d)`).join(", ") || "—"}`,
      `  signal: ${describe(backlog.signal)}`,
    );

    const missions = await prisma.mission.findMany({
      where: { userId: profile.id, status: "active" },
      select: {
        topic: true,
        createdAt: true,
        sessions: { select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 },
      },
    });
    const stalls = detectStalls(
      missions.map((mission) => ({
        missionId: mission.topic,
        createdOn: localDay(mission.createdAt, tz),
        lastSessionOn:
          mission.sessions[0] === undefined ? null : localDay(mission.sessions[0].startedAt, tz),
      })),
      { today },
    );

    out.push(
      "",
      "stall detection",
      `  ${stalls.map((s) => `${s.missionId} (${s.untouchedDays}d)`).join(", ") || "nothing stalled"}`,
      "",
    );

    process.stdout.write(out.join("\n"));
  } finally {
    await prisma.$disconnect();
  }
}

function describe(signal: unknown): string {
  return signal === null ? "none — nothing honest to say" : JSON.stringify(signal);
}

await main();
