import { addDays, dayOfWeek, eachDay, type IsoDate } from "@mindforge/core";
import { rebuildDailyActivity } from "../src/index.js";
import {
  at,
  configureProfile,
  connect,
  parseOptions,
  provisionUser,
  random,
  wipeUser,
  type Random,
} from "./seed-support.js";

/**
 * `seed:rich` — six months of history, so the trackers can be designed against something.
 *
 * A grid of four days does not tell you how a grid looks, and a curriculum with one module does not
 * tell you whether the progress screen survives a real one.
 *
 * **The history is shaped, not sprinkled.** Random noise produces a screen where every derived line
 * is null and every bar is the same height, which is the one shape that proves nothing. So this data
 * is arranged to make each derived signal fire at least once, and each of these is a real pattern a
 * real user could have:
 *
 * - **No Saturday, ever.** Fires the grid's `never_on_weekday` line — the fact the grid is uniquely
 *   good at surfacing, and the one no other view would tell you.
 * - **A parked mission**, so every screen that must exclude one has something to exclude.
 * - **A stretch in the middle where nothing happened.** Real months contain one, and a grid that has
 *   never been shown a gap tends to have a layout that cannot survive one.
 * - **Modules in every state**: done with every lesson understood, done with a shaky lesson still in
 *   it, active and half-taught, proposed and untouched, and one dropped by a revision.
 * - **Lessons in every state**: completed-understood, completed-shaky, completed-lost, and generated
 *   but never opened.
 */

const DAYS = 180;

const INTENTIONS: readonly string[] = [
  "Do the next lesson and write down what I did not follow.",
  "Make the failing test pass without looking at the answer.",
  "Read one section properly rather than three badly.",
  "Rewrite yesterday's function without the clone.",
  "Understand the error, not just silence it.",
  "Half an hour, no tabs.",
];

interface Named {
  readonly id: string;
}

interface TrackSpec {
  readonly slug: string;
  readonly name: string;
  readonly outcome: string;
  readonly prereqs: readonly string[];
  readonly status: "proposed" | "active" | "done" | "dropped";
  /** Lessons: [slug, title, outcome | null], in seq order. Null outcome = never opened. */
  readonly lessons: readonly (readonly [string, string, "understood" | "shaky" | "lost" | null])[];
  /**
   * Lessons the curriculum planned and nothing has written yet (FR-K2):
   * `[slug, title, difficulty, depth, depends-on slugs]`.
   *
   * These are what make the curriculum screen worth looking at in a seeded
   * account. Without them every module is finished or empty, and the two states
   * the screen exists to show — locked, and what to do next — never appear.
   */
  readonly planned?: readonly (readonly [
    string,
    string,
    number,
    "overview" | "working" | "deep_dive",
    readonly string[],
  ])[];
}

const RUST_TRACKS: readonly TrackSpec[] = [
  {
    slug: "syntax-and-tooling",
    name: "Syntax and tooling",
    outcome: "Write, build and test a toy crate without fighting cargo.",
    prereqs: [],
    status: "done",
    lessons: [
      ["cargo-and-crates", "Cargo and crates", "understood"],
      ["types-and-control-flow", "Types and control flow", "understood"],
      ["pattern-matching", "Pattern matching", "understood"],
    ],
  },
  {
    slug: "ownership",
    name: "Ownership and borrowing",
    outcome: "Explain a borrow-checker error without guessing.",
    prereqs: ["syntax-and-tooling"],
    status: "done",
    lessons: [
      ["moves-and-copies", "Moves and copies", "understood"],
      ["exclusive-references", "Exclusive references", "shaky"],
      ["slices-and-views", "Slices and views", "understood"],
      ["borrow-checker-errors", "Borrow checker errors as a tool", "understood"],
    ],
  },
  {
    slug: "lifetimes",
    name: "Lifetimes",
    outcome: "Annotate a function whose lifetimes the compiler cannot elide.",
    prereqs: ["ownership"],
    status: "active",
    lessons: [
      ["elision-rules", "What the compiler already knows", "understood"],
      ["annotating-functions", "Annotating functions", "lost"],
      ["structs-holding-references", "Structs that hold references", null],
    ],
    // The open module, mid-plan: two written, one unread, two still ahead — and
    // the last of those is locked behind one of them.
    planned: [
      [
        "lifetimes-in-impls",
        "Lifetimes in impl blocks",
        4,
        "working",
        ["structs-holding-references"],
      ],
      ["higher-ranked", "Higher-ranked trait bounds", 5, "deep_dive", ["lifetimes-in-impls"]],
    ],
  },
  {
    slug: "traits",
    name: "Traits and generics",
    outcome: "Design a small API around traits rather than concrete types.",
    prereqs: ["ownership"],
    status: "proposed",
    lessons: [],
    // A module planned in full and not started: every lesson unblocked-by-plan
    // but gated behind the module before it, which is the common shape.
    planned: [
      ["defining-traits", "Defining a trait", 2, "overview", []],
      ["generic-functions", "Generic functions", 3, "working", ["defining-traits"]],
      ["trait-objects", "Trait objects and dispatch", 4, "deep_dive", ["generic-functions"]],
    ],
  },
  {
    slug: "error-handling",
    name: "Error handling",
    outcome: "Choose between panic, Result and custom errors deliberately.",
    prereqs: ["traits"],
    status: "proposed",
    lessons: [],
  },
  {
    slug: "async-rust",
    name: "Async Rust",
    outcome: "Explain what .await yields and to whom.",
    prereqs: ["traits", "error-handling"],
    status: "proposed",
    lessons: [],
  },
  {
    // Dropped by a curriculum revision. The progress screen has to render one
    // without counting it in any denominator.
    slug: "macros",
    name: "Macros",
    outcome: "Read a declarative macro without fear.",
    prereqs: ["syntax-and-tooling"],
    status: "dropped",
    lessons: [],
  },
];

const DIST_TRACKS: readonly TrackSpec[] = [
  {
    slug: "failure-models",
    name: "Failure models",
    outcome: "Name what can go wrong before designing for it.",
    prereqs: [],
    status: "done",
    lessons: [
      ["network-is-not-reliable", "The network is not reliable", "understood"],
      ["clocks-and-ordering", "Clocks and ordering", "shaky"],
    ],
  },
  {
    slug: "replication",
    name: "Replication",
    outcome: "Explain the trade a quorum makes.",
    prereqs: ["failure-models"],
    status: "active",
    lessons: [["leaders-and-followers", "Leaders and followers", "understood"]],
    planned: [
      ["quorums", "Quorums and the trade they make", 3, "working", []],
      ["read-repair", "Read repair", 4, "deep_dive", ["quorums"]],
    ],
  },
  {
    slug: "consensus",
    name: "Consensus",
    outcome: "Walk someone through a Raft election without notes.",
    prereqs: ["replication"],
    status: "proposed",
    lessons: [],
  },
];

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const prisma = connect();
  const r = random(0x6d1f_e2b3);

  try {
    const userId = await provisionUser(options.email, options.password);
    await wipeUser(prisma, userId);
    await configureProfile(prisma, userId, options);

    const { timezone: tz, today } = options;
    const from = addDays(today, -(DAYS - 1));

    const missions = await seedMissions(prisma, userId, from);
    const lessons = {
      count: 0,
      completed: 0,
      planned: 0,
    };
    const trackCount =
      (await seedCurriculum(
        prisma,
        userId,
        missions[0]!,
        "rust-properly",
        RUST_TRACKS,
        from,
        10,
        tz,
        lessons,
      )) +
      (await seedCurriculum(
        prisma,
        userId,
        missions[1]!,
        "distributed-systems",
        DIST_TRACKS,
        from,
        40,
        tz,
        lessons,
      ));

    const activeDays = chooseActiveDays(from, today, r);
    const sessionCount = await seedSessions(prisma, userId, activeDays, missions, tz, r);

    const rollup = await rebuildDailyActivity(
      prisma,
      userId,
      tz,
      { from, to: today },
      new Date(Date.now()),
    );

    process.stdout.write(
      `seed:rich — ${options.email} / ${options.password} (${tz})\n` +
        `  ${DAYS} days from ${from} to ${today}\n` +
        `  ${missions.length} missions, ${trackCount} tracks, ${lessons.count} lessons ` +
        `(${lessons.completed} completed, ${lessons.planned} planned, not yet written)\n` +
        `  ${sessionCount} sessions on ${activeDays.length} days, ${rollup.daysWritten} rollup rows\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function seedMissions(
  prisma: ReturnType<typeof connect>,
  userId: string,
  from: IsoDate,
): Promise<Named[]> {
  const specs = [
    {
      topic: "Rust, properly",
      why: "I keep reaching for Go because I never got past the borrow checker.",
      successLooksLike: "Ship a small CLI I would be happy for someone else to read.",
      status: "active",
      workspaceKey: "rust-properly",
      offset: 0,
    },
    {
      topic: "Distributed systems fundamentals",
      why: "I can operate them and I cannot reason about them, which is the wrong way round.",
      successLooksLike: "Explain Raft to someone else without notes.",
      status: "active",
      workspaceKey: "distributed-systems",
      offset: 20,
    },
    {
      // Parked, not abandoned. Every screen that must exclude one has something
      // to exclude, and the activity grid must still count its history.
      topic: "Learn to sight-read",
      why: "Started in a burst of enthusiasm and have not opened it since.",
      successLooksLike: "Play an easy piece I have never seen, slowly, without stopping.",
      status: "parked",
      workspaceKey: "sight-reading",
      offset: 45,
    },
  ];

  const created: Named[] = [];
  for (const spec of specs) {
    const createdAt = new Date(`${addDays(from, spec.offset)}T09:00:00.000Z`);
    created.push(
      await prisma.mission.create({
        data: {
          userId,
          topic: spec.topic,
          why: spec.why,
          successLooksLike: spec.successLooksLike,
          status: spec.status,
          workspaceKey: spec.workspaceKey,
          createdAt,
          updatedAt: createdAt,
        },
        select: { id: true },
      }),
    );
  }
  return created;
}

/**
 * One mission's curriculum: tracks, edges, and the lessons its modules hold.
 *
 * Lesson `seq` is mission-global, matching the reindexer's rule, and completion
 * dates walk forward through the history so the time and progress trackers agree
 * about when things happened.
 */
async function seedCurriculum(
  prisma: ReturnType<typeof connect>,
  userId: string,
  mission: Named,
  workspaceKey: string,
  tracks: readonly TrackSpec[],
  from: IsoDate,
  startOffset: number,
  tz: string,
  tally: { count: number; completed: number; planned: number },
): Promise<number> {
  const bySlug = new Map<string, string>();

  for (const [index, spec] of tracks.entries()) {
    const created = await prisma.track.create({
      data: {
        userId,
        missionId: mission.id,
        slug: spec.slug,
        name: spec.name,
        outcome: spec.outcome,
        position: index + 1,
        status: spec.status,
      },
      select: { id: true },
    });
    bySlug.set(spec.slug, created.id);
  }

  for (const spec of tracks) {
    for (const prereq of spec.prereqs) {
      await prisma.trackEdge.create({
        data: { userId, trackId: bySlug.get(spec.slug)!, prereqId: bySlug.get(prereq)! },
      });
    }
  }

  let seq = 0;
  let day = addDays(from, startOffset);
  for (const spec of tracks) {
    for (const [index, [slug, title, outcome]] of spec.lessons.entries()) {
      seq += 1;
      tally.count += 1;
      // Lessons complete every few days; the last ones land well inside the window.
      day = addDays(day, 4 + (seq % 3));
      const completedAt = outcome === null ? null : at(day, 21, 30, tz);
      if (outcome !== null) tally.completed += 1;

      await prisma.lesson.create({
        data: {
          userId,
          missionId: mission.id,
          trackId: bySlug.get(spec.slug)!,
          seq,
          slug,
          title,
          // A written lesson keeps the plan half of its row, because a real one
          // does: it was planned before it was written, and the curriculum screen
          // reads difficulty and depth on every lesson, not only the pending ones.
          // Derived from where it sits rather than listed per lesson — a module
          // that starts easy and deepens is the shape being imitated.
          intent: `What ${title.toLowerCase()} buys you.`,
          difficulty: Math.min(5, index + 1),
          depth: index === 0 ? "overview" : "working",
          position: index + 1,
          storagePath: `workspaces/${userId}/${workspaceKey}/lessons/${String(seq).padStart(4, "0")}-${slug}.html`,
          contentHash: `seed-${workspaceKey}-${seq}`,
          completedAt,
          outcome,
        },
      });
    }
  }

  await seedPlan(prisma, userId, mission, tracks, bySlug, tally);

  return tracks.length;
}

/**
 * The lessons a curriculum planned and nothing has written yet.
 *
 * Written after every module's lessons exist, because a plan entry may depend on
 * one already written — which is the case the curriculum screen has to get right:
 * a lesson waiting on an unread lesson is locked, and a lesson waiting on a
 * finished one is what to do next.
 */
async function seedPlan(
  prisma: ReturnType<typeof connect>,
  userId: string,
  mission: Named,
  tracks: readonly TrackSpec[],
  bySlug: ReadonlyMap<string, string>,
  tally: { count: number; planned: number },
): Promise<void> {
  const lessonIds = new Map<string, string>();

  for (const existing of await prisma.lesson.findMany({
    where: { userId, missionId: mission.id },
    select: { id: true, slug: true },
  })) {
    lessonIds.set(existing.slug, existing.id);
  }

  for (const spec of tracks) {
    for (const [index, [slug, title, difficulty, depth]] of (spec.planned ?? []).entries()) {
      tally.count += 1;
      tally.planned += 1;

      const created = await prisma.lesson.create({
        data: {
          userId,
          missionId: mission.id,
          trackId: bySlug.get(spec.slug)!,
          status: "planned",
          slug,
          title,
          intent: `What ${title.toLowerCase()} buys you.`,
          difficulty,
          depth,
          position: spec.lessons.length + index + 1,
        },
        select: { id: true },
      });
      lessonIds.set(slug, created.id);
    }
  }

  for (const spec of tracks) {
    for (const [slug, , , , dependsOn] of spec.planned ?? []) {
      for (const prereq of dependsOn) {
        const prereqId = lessonIds.get(prereq);
        if (prereqId === undefined) continue;
        await prisma.lessonEdge.create({
          data: { userId, lessonId: lessonIds.get(slug)!, prereqId },
        });
      }
    }
  }
}

/**
 * Which days had a session.
 *
 * Three shaping rules, each of which makes a specific signal real:
 *
 * - Never a Saturday, so `never_on_weekday` has something true to say.
 * - Weekdays far likelier than Sundays, because that is what a working week looks like.
 * - One dead fortnight, because real months contain them and a grid that has never been shown a gap
 *   tends to have a layout that cannot survive one.
 */
function chooseActiveDays(from: IsoDate, today: IsoDate, r: Random): IsoDate[] {
  const gapStart = addDays(from, 96);
  const gapEnd = addDays(gapStart, 13);

  return eachDay(from, today).filter((day) => {
    if (day >= gapStart && day <= gapEnd) return false;
    const weekday = dayOfWeek(day);
    if (weekday === 6) return false;
    if (weekday === 0) return r.chance(0.15);
    return r.chance(0.62);
  });
}

async function seedSessions(
  prisma: ReturnType<typeof connect>,
  userId: string,
  activeDays: readonly IsoDate[],
  missions: readonly Named[],
  tz: string,
  r: Random,
): Promise<number> {
  // The parked mission stops receiving sessions, which is what makes it look
  // parked in the history rather than merely flagged as such.
  const workedOn = missions.slice(0, 2);
  let count = 0;

  for (const day of activeDays) {
    const blocks = r.chance(0.28) ? 2 : 1;
    for (let block = 0; block < blocks; block += 1) {
      const hour = block === 0 ? r.between(8, 11) : r.between(19, 21);
      const minutes = r.pick([25, 30, 40, 45, 50, 60, 75, 90]);
      const startedAt = at(day, hour, r.pick([0, 15, 30]), tz);

      await prisma.focusSession.create({
        data: {
          userId,
          missionId: r.pick(workedOn).id,
          intention: r.pick(INTENTIONS),
          startedAt,
          endedAt: new Date(startedAt.getTime() + minutes * 60_000),
          // A fifth of sessions have no debrief at all — the case every screen
          // has to render without inventing an answer.
          hitIntention: r.chance(0.2)
            ? null
            : r.pick(["yes", "yes", "yes", "partly", "partly", "no"]),
          focusQuality: r.between(2, 5),
          energy: r.between(2, 5),
          entryMode: r.chance(0.18) ? "backfilled" : "timer",
        },
      });
      count += 1;
    }
  }
  return count;
}

await main();
