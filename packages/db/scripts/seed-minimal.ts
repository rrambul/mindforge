import { addDays } from "@mindforge/core";
import { rebuildDailyActivity } from "../src/index.js";
import {
  at,
  configureProfile,
  connect,
  parseOptions,
  provisionUser,
  wipeUser,
} from "./seed-support.js";

/**
 * `seed:minimal` — enough to click through every screen, and no more.
 *
 * The counterpart to `seed:rich`. This one exists so that a fresh clone has an account with one of
 * everything the focused flow touches: a mission with a small curriculum (three tracks, one edge),
 * a module with lessons in three states — completed-understood, completed-shaky, and unread — and a
 * few focus sessions behind the grid.
 *
 * Deliberately too small to design the trackers against. A grid built from four days tells you
 * nothing about how a grid looks, which is what `seed:rich` is for.
 */

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const prisma = connect();

  try {
    const userId = await provisionUser(options.email, options.password);
    await wipeUser(prisma, userId);
    await configureProfile(prisma, userId, options);

    const { timezone: tz, today } = options;

    const mission = await prisma.mission.create({
      data: {
        userId,
        topic: "Rust, properly",
        why: "I keep reaching for Go because I never got past the borrow checker.",
        successLooksLike: "Ship a small CLI I would be happy for someone else to read.",
        currentLevel: "Can read it. Cannot write it without fighting.",
        workspaceKey: "rust-properly",
      },
    });

    const fundamentals = await prisma.track.create({
      data: {
        userId,
        missionId: mission.id,
        slug: "syntax-and-tooling",
        name: "Syntax and tooling",
        outcome: "Write, build and test a toy crate without fighting cargo.",
        position: 1,
        status: "done",
      },
    });
    const ownership = await prisma.track.create({
      data: {
        userId,
        missionId: mission.id,
        slug: "ownership",
        name: "Ownership and borrowing",
        outcome: "Explain a borrow-checker error without guessing.",
        position: 2,
        status: "active",
      },
    });
    const lifetimes = await prisma.track.create({
      data: {
        userId,
        missionId: mission.id,
        slug: "lifetimes",
        name: "Lifetimes",
        outcome: "Annotate a function whose lifetimes the compiler cannot elide.",
        position: 3,
        status: "proposed",
      },
    });
    await prisma.trackEdge.createMany({
      data: [
        { userId, trackId: ownership.id, prereqId: fundamentals.id },
        { userId, trackId: lifetimes.id, prereqId: ownership.id },
      ],
    });

    const workspace = `workspaces/${userId}/rust-properly`;
    const lesson = (seq: number, slug: string, title: string, trackId: string) => ({
      userId,
      missionId: mission.id,
      trackId,
      seq,
      slug,
      title,
      storagePath: `${workspace}/lessons/${String(seq).padStart(4, "0")}-${slug}.html`,
      contentHash: `seed-${seq}`,
    });

    // Three states on purpose: understood, shaky, and unread. A progress screen
    // built only against completed lessons quietly assumes completion.
    await prisma.lesson.create({
      data: {
        ...lesson(1, "moves-and-copies", "Moves and copies", ownership.id),
        completedAt: at(addDays(today, -3), 9, 40, tz),
        outcome: "understood",
      },
    });
    await prisma.lesson.create({
      data: {
        ...lesson(2, "exclusive-references", "Exclusive references", ownership.id),
        completedAt: at(addDays(today, -1), 21, 10, tz),
        outcome: "shaky",
      },
    });
    await prisma.lesson.create({
      data: lesson(3, "borrow-checker-errors", "Borrow checker errors as a tool", ownership.id),
    });

    await prisma.learningRecord.create({
      data: {
        userId,
        missionId: mission.id,
        seq: 1,
        title: "Exclusive, not mutable",
        whatLearned:
          "A `&mut` is not a mutable reference, it is an *exclusive* one. That framing fixed most of my errors.",
        keyInsight: "Aliasing XOR mutation is the whole model.",
        next: "Borrow-checker error messages as a debugging tool.",
        storagePath: `${workspace}/learning-records/0001-exclusive-not-mutable.md`,
        contentHash: "seed-r1",
        recordedAt: at(addDays(today, -1), 21, 40, tz),
      },
    });

    // Four days, so the grid renders something rather than nothing.
    const sessions = [
      { day: addDays(today, -4), hour: 8, minutes: 50, hit: "yes" },
      { day: addDays(today, -3), hour: 21, minutes: 35, hit: "partly" },
      { day: addDays(today, -1), hour: 9, minutes: 65, hit: "yes" },
      { day: today, hour: 14, minutes: 40, hit: "no" },
    ] as const;

    for (const spec of sessions) {
      const startedAt = at(spec.day, spec.hour, 0, tz);
      await prisma.focusSession.create({
        data: {
          userId,
          missionId: mission.id,
          intention: "Do the next lesson and write down what I did not follow.",
          startedAt,
          endedAt: new Date(startedAt.getTime() + spec.minutes * 60_000),
          hitIntention: spec.hit,
          focusQuality: 3,
          energy: 3,
        },
      });
    }

    const rollup = await rebuildDailyActivity(
      prisma,
      userId,
      tz,
      { from: addDays(today, -30), to: today },
      new Date(Date.now()),
    );

    process.stdout.write(
      `seed:minimal — ${options.email} / ${options.password}\n` +
        `  1 mission, 3 tracks, 3 lessons, 4 sessions, ${rollup.daysWritten} active days\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
