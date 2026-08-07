import { addDays, startOfWeek } from "@mindforge/core";
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
 * The counterpart to `seed:rich`. This one exists so that `prisma migrate dev` has something to run
 * after a reset and so a fresh clone has an account with one of everything: a mission, a goal with a
 * measurable target, two skills with an edge between them, two resources at different statuses, a
 * few sessions with friction, a note, and one week's plan.
 *
 * Deliberately too small to design insights against. A grid built from four days tells you nothing
 * about how a grid looks, which is what `seed:rich` is for.
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
      },
    });

    const ownership = await prisma.skill.create({
      data: { userId, name: "Ownership and borrowing", slug: "ownership", band: "assisted" },
    });
    const lifetimes = await prisma.skill.create({
      data: { userId, name: "Lifetimes", slug: "lifetimes", band: "aware" },
    });
    await prisma.skillEdge.create({
      data: { userId, skillId: lifetimes.id, prereqId: ownership.id },
    });

    const book = await prisma.resource.create({
      data: {
        userId,
        type: "book",
        title: "Programming Rust",
        author: "Blandy, Orendorff & Tindall",
        status: "active",
        progress: { unit: "page", current: 137, total: 736 },
      },
    });
    await prisma.resource.create({
      data: {
        userId,
        type: "article",
        title: "Common Rust Lifetime Misconceptions",
        url: "https://github.com/pretzelhammer/rust-blog",
        status: "queued",
        progress: { unit: "percent", current: 0, total: 100 },
      },
    });
    await prisma.resourceLink.create({
      data: { userId, resourceId: book.id, missionId: mission.id, skillId: ownership.id },
    });

    const goal = await prisma.goal.create({
      data: {
        userId,
        missionId: mission.id,
        title: "Finish Programming Rust and get to working on ownership",
        definitionOfDone: "Book done, and I can explain borrow-checker errors without guessing.",
        targetDate: new Date(`${addDays(today, 90)}T00:00:00.000Z`),
      },
    });
    await prisma.goalTarget.createMany({
      data: [
        {
          userId,
          goalId: goal.id,
          kind: "resource_progress",
          resourceId: book.id,
          target: { percent: 100 },
        },
        {
          userId,
          goalId: goal.id,
          kind: "skill_band",
          skillId: ownership.id,
          target: { band: "working" },
          bandAtStart: "assisted",
        },
      ],
    });

    // Four days, so the grid renders something rather than nothing. A frictionless session is in
    // there on purpose: it is the case that contributes to focus minutes and to neither ember nor
    // slag, and it is easy to build a screen that quietly assumes it cannot happen.
    const days = [addDays(today, -4), addDays(today, -3), addDays(today, -1), today];
    const sessions = [
      { day: days[0]!, hour: 8, minutes: 50, hit: "yes", friction: [["too_hard", 4]] },
      { day: days[1]!, hour: 21, minutes: 35, hit: "partly", friction: [["tooling", 5]] },
      { day: days[2]!, hour: 9, minutes: 65, hit: "yes", friction: [] },
      {
        day: days[3]!,
        hour: 14,
        minutes: 40,
        hit: "no",
        friction: [
          ["interruption", 2],
          ["productive_struggle", 4],
        ],
      },
    ] as const;

    for (const spec of sessions) {
      const startedAt = at(spec.day, spec.hour, 0, tz);
      const session = await prisma.focusSession.create({
        data: {
          userId,
          missionId: mission.id,
          resourceId: book.id,
          skillId: ownership.id,
          intention: "Read a chapter and write down what I did not follow.",
          startedAt,
          endedAt: new Date(startedAt.getTime() + spec.minutes * 60_000),
          hitIntention: spec.hit,
          focusQuality: 3,
          energy: 3,
        },
      });

      for (const [type, intensity] of spec.friction) {
        await prisma.frictionEvent.create({
          data: {
            userId,
            sessionId: session.id,
            skillId: ownership.id,
            type,
            intensity,
            occurredAt: new Date(startedAt.getTime() + 10 * 60_000),
          },
        });
      }
    }

    await prisma.note.create({
      data: {
        userId,
        subjectType: "skill",
        subjectId: ownership.id,
        body: "A `&mut` is not a mutable reference, it is an *exclusive* one. That framing fixed most of my errors.",
        lang: "english",
        createdAt: at(days[2]!, 10, 30, tz),
      },
    });

    const weekStart = startOfWeek(today, 0);
    const plan = await prisma.weeklyPlan.create({
      data: { userId, weekStart: new Date(`${weekStart}T00:00:00.000Z`) },
    });
    await prisma.weeklyAllocation.createMany({
      data: [
        { userId, planId: plan.id, missionId: mission.id, plannedMinutes: 300 },
        { userId, planId: plan.id, skillId: lifetimes.id, plannedMinutes: 60 },
      ],
    });

    const rollup = await rebuildDailyActivity(
      prisma,
      userId,
      tz,
      { from: addDays(today, -30), to: today },
      new Date(Date.now()),
    );

    process.stdout.write(
      `seed:minimal — ${options.email} / ${options.password}\n` +
        `  1 mission, 2 skills, 2 resources, 1 goal, 4 sessions, ${rollup.daysWritten} active days\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
