import { addDays, buildGrid, type ActivityDay } from "@mindforge/core";
import { connect, parseOptions } from "./seed-support.js";

/**
 * What the seeded account actually looks like to the tracker functions.
 *
 * `seed:rich` can report "180 days, 101 sessions" and still have produced a screen where every grid
 * cell is the same shade and no signal has ever fired — which is the one shape that proves nothing
 * and is exactly what a naive random seed produces. This runs the real `packages/core` functions
 * over the seeded rows and prints what they say, so "the fixture is designable" is a thing you can
 * check rather than a thing you hope.
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
    }));

    const grid = buildGrid(days, { from: addDays(today, -179), to: today });
    const spread = [0, 1, 2, 3, 4]
      .map((step) => `${step}:${grid.cells.filter((c) => c.intensity === step).length}`)
      .join("  ");

    out.push(
      "",
      "frequency — activity grid",
      `  cells ${grid.cells.length}, of which ${grid.cells.filter((c) => c.intensity > 0).length} have something on them`,
      `  intensity  ${spread}`,
      `  active days in 28: ${grid.activeDaysIn28}`,
      `  signal: ${grid.signal === null ? "none — nothing honest to say" : JSON.stringify(grid.signal)}`,
    );

    // Progress: completed over generated per module. Computed here the way the
    // screen will compute it — from lesson rows, on read.
    const tracks = await prisma.track.findMany({
      where: { userId: profile.id },
      orderBy: [{ missionId: "asc" }, { position: "asc" }],
      select: {
        name: true,
        status: true,
        mission: { select: { topic: true } },
        lessons: { select: { completedAt: true, outcome: true } },
      },
    });

    out.push("", "progress — modules");
    for (const track of tracks) {
      const done = track.lessons.filter((lesson) => lesson.completedAt !== null);
      const outcomes = ["understood", "shaky", "lost"]
        .map((o) => `${o}:${done.filter((lesson) => lesson.outcome === o).length}`)
        .join(" ");
      out.push(
        `  [${track.mission.topic}] ${track.name} (${track.status}) — ` +
          (track.lessons.length === 0
            ? "no lessons yet"
            : `${done.length}/${track.lessons.length} lessons done (${outcomes})`),
      );
    }

    const minutes = await prisma.focusSession.aggregate({
      where: { userId: profile.id },
      _count: true,
    });
    out.push("", "time — focus sessions", `  ${minutes._count} sessions recorded`, "");

    process.stdout.write(out.join("\n"));
  } finally {
    await prisma.$disconnect();
  }
}

await main();
