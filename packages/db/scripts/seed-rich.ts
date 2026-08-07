import { addDays, dayOfWeek, eachDay, startOfWeek, type IsoDate } from "@mindforge/core";
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
 * `seed:rich` — six months of history, so the insights can be designed against something.
 *
 * An M0 bullet that went unwritten, and TECH-DESIGN §14 is blunt about the cost: the activity grid,
 * the decay curves and every insight are "unbuildable against an empty database". A grid of four
 * days does not tell you how a grid looks, and a plan-vs-actual bar with one week behind it does not
 * tell you whether the layout survives a bad month.
 *
 * **The history is shaped, not sprinkled.** Random noise produces a screen where every insight is
 * null and every bar is the same height, which is the one shape that proves nothing. So this data is
 * arranged to make each derived signal fire at least once, and each of these is a real pattern a
 * real user could have:
 *
 * - **No Saturday, ever.** Fires the grid's `never_on_weekday` line — the fact §3.9 says the grid is
 *   uniquely good at surfacing, and the one no other view would tell you.
 * - **Roughly three active days a week against plans that assume five.** Fires `pace_below_plan`,
 *   §3.9's own worked example.
 * - **Three resources started and left.** Fires the backlog's `stalling` signal.
 * - **A parked mission**, so every screen that must exclude one has something to exclude (§5.3).
 * - **Sessions with no friction at all**, which is the case that contributes to focus minutes and to
 *   neither ember nor slag, and is easy to build a screen that assumes away.
 * - **A stretch in March where nothing happened.** Real weeks look like that, and a grid that has
 *   never been shown a gap tends to have a layout that cannot survive one.
 */

const DAYS = 180;

/** Roughly what a year of logged friction looks like, rather than a uniform draw over eleven types. */
const FRICTION_MIX: readonly (readonly [string, number])[] = [
  ["interruption", 18],
  ["productive_struggle", 15],
  ["self_interruption", 13],
  ["tooling", 12],
  ["too_hard", 12],
  ["unclear_material", 9],
  ["decision_fatigue", 6],
  ["avoidance", 6],
  ["physical", 5],
  ["missing_prerequisite", 2],
  ["too_easy", 2],
];

const FRICTION_TABLE: readonly string[] = FRICTION_MIX.flatMap(([type, weight]) =>
  Array.from({ length: weight }, () => type),
);

const INTENTIONS: readonly string[] = [
  "Get through the chapter and write down what I did not follow.",
  "Make the failing test pass without looking at the answer.",
  "Read one section properly rather than three badly.",
  "Rewrite yesterday's function without the clone.",
  "Understand the error, not just silence it.",
  "Half an hour, no tabs.",
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
    const skills = await seedSkills(prisma, userId);
    const resources = await seedResources(prisma, userId, missions, skills, from, today, r);
    await seedGoals(prisma, userId, missions, skills, resources, today);

    const activeDays = chooseActiveDays(from, today, r);
    const sessionCount = await seedSessions(
      prisma,
      userId,
      activeDays,
      missions,
      skills,
      resources,
      tz,
      r,
    );
    const noteCount = await seedNotes(prisma, userId, activeDays, missions, skills, tz, r);
    const { plans, reviews } = await seedPlanning(prisma, userId, missions, skills, today, r);

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
        `  ${missions.length} missions, ${skills.length} skills, ${resources.length} resources\n` +
        `  ${sessionCount} sessions on ${activeDays.length} days, ${noteCount} notes\n` +
        `  ${plans} weekly plans, ${reviews} reviews, ${rollup.daysWritten} rollup rows\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

interface Named {
  readonly id: string;
}

interface Titled extends Named {
  readonly title: string;
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
      status: "active",
      offset: 0,
    },
    {
      topic: "Distributed systems fundamentals",
      why: "I can operate them and I cannot reason about them, which is the wrong way round.",
      status: "active",
      offset: 20,
    },
    {
      topic: "Writing that people finish",
      why: "My design docs are read by nobody past the second heading.",
      status: "active",
      offset: 70,
    },
    {
      // Parked, not abandoned. Every screen that must exclude one now has something to exclude
      // (§5.3), and the activity grid must still count its history.
      topic: "Learn to sight-read",
      why: "Started in a burst of enthusiasm in March and have not opened it since.",
      status: "parked",
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
          status: spec.status,
          createdAt,
          updatedAt: createdAt,
        },
        select: { id: true },
      }),
    );
  }
  return created;
}

async function seedSkills(prisma: ReturnType<typeof connect>, userId: string): Promise<Named[]> {
  const specs = [
    ["Ownership and borrowing", "ownership", "working"],
    ["Lifetimes", "lifetimes", "assisted"],
    ["Traits and generics", "traits", "assisted"],
    ["Async Rust", "async-rust", "aware"],
    ["Consensus", "consensus", "aware"],
    ["Replication", "replication", "assisted"],
    ["Failure modes", "failure-modes", "working"],
    ["Structuring an argument", "argument", "working"],
    ["Editing your own prose", "editing", "assisted"],
    ["Diagrams that carry weight", "diagrams", "aware"],
  ] as const;

  const created: Named[] = [];
  for (const [name, slug, band] of specs) {
    created.push(
      await prisma.skill.create({ data: { userId, name, slug, band }, select: { id: true } }),
    );
  }

  // A shallow DAG rather than a chain: prerequisite depth is what the skills screen renders, and a
  // straight line would never exercise a node with two parents.
  const edges: readonly (readonly [number, number])[] = [
    [1, 0],
    [2, 0],
    [3, 1],
    [3, 2],
    [4, 6],
    [5, 6],
    [8, 7],
    [9, 7],
  ];
  for (const [skill, prereq] of edges) {
    await prisma.skillEdge.create({
      data: { userId, skillId: created[skill]!.id, prereqId: created[prereq]!.id },
    });
  }
  return created;
}

/**
 * One goal per active mission, each with two targets of different kinds.
 *
 * Two kinds on purpose: §3.8 derives progress per kind, and a goal whose targets are all
 * `resource_progress` never exercises the path where one target is measurable and another is not.
 * The third goal is deliberately past its date — a goal is allowed to fail, and an overdue one is
 * data rather than a blemish.
 */
async function seedGoals(
  prisma: ReturnType<typeof connect>,
  userId: string,
  missions: readonly Named[],
  skills: readonly Named[],
  resources: readonly Named[],
  today: IsoDate,
): Promise<void> {
  const specs = [
    {
      mission: 0,
      title: "Finish Programming Rust and get to working on ownership",
      due: 60,
      resource: 0,
      skill: 0,
      bandAtStart: "assisted",
    },
    {
      mission: 1,
      title: "Explain Raft to someone else without notes",
      due: 90,
      resource: 10,
      skill: 4,
      bandAtStart: "aware",
    },
    {
      mission: 2,
      title: "Ship a design doc people read to the end",
      due: -12,
      resource: 5,
      skill: 7,
      bandAtStart: "working",
    },
  ] as const;

  for (const spec of specs) {
    const goal = await prisma.goal.create({
      data: {
        userId,
        missionId: missions[spec.mission]!.id,
        title: spec.title,
        targetDate: new Date(`${addDays(today, spec.due)}T00:00:00.000Z`),
      },
      select: { id: true },
    });

    await prisma.goalTarget.createMany({
      data: [
        {
          userId,
          goalId: goal.id,
          kind: "resource_progress",
          resourceId: resources[spec.resource]!.id,
          target: { percent: 100 },
        },
        {
          userId,
          goalId: goal.id,
          kind: "skill_band",
          skillId: skills[spec.skill]!.id,
          target: { band: "fluent" },
          bandAtStart: spec.bandAtStart,
        },
      ],
    });
  }
}

async function seedResources(
  prisma: ReturnType<typeof connect>,
  userId: string,
  missions: readonly Named[],
  skills: readonly Named[],
  from: IsoDate,
  today: IsoDate,
  r: Random,
): Promise<Titled[]> {
  const specs = [
    ["book", "Programming Rust", "active", null, 0],
    ["book", "Rust for Rustaceans", "queued", null, 40],
    ["book", "Designing Data-Intensive Applications", "active", null, 15],
    ["book", "Database Internals", "inbox", null, 120],
    ["book", "On Writing Well", "finished", null, 10],
    // Three actives that never get a session — see STALLED below.
    ["book", "The Sense of Style", "active", null, 60],
    ["article", "Common Rust Lifetime Misconceptions", "finished", null, 5],
    ["article", "Notes on Distributed Systems for Young Bloods", "finished", null, 22],
    ["article", "The Log: What every engineer should know", "abandoned", "too_shallow", 30],
    ["article", "A Philosophy of Software Design, reviewed", "queued", null, 130],
    ["paper", "In Search of an Understandable Consensus Algorithm", "active", null, 35],
    ["paper", "Time, Clocks and the Ordering of Events", "finished", null, 28],
    ["paper", "Harvest, Yield and Scalable Tolerant Systems", "abandoned", "wrong_level", 55],
    ["course", "Rust: from zero to production", "abandoned", "no_longer_relevant", 18],
    ["course", "MIT 6.824", "active", null, 25],
    ["video", "Crust of Rust: Lifetime Annotations", "finished", null, 12],
    ["video", "How to write a good design doc", "queued", null, 140],
    ["podcast", "Oxide and Friends on debugging", "finished", null, 48],
    ["podcast", "Rustacean Station, async episode", "inbox", null, 160],
    ["docs", "The Rustonomicon", "reference", null, 8],
    ["docs", "Tokio tutorial", "reference", null, 33],
    ["docs", "Raft visualisation", "reference", null, 36],
    ["book", "Refactoring UI", "abandoned", "lost_interest", 65],
    ["book", "Site Reliability Engineering", "queued", null, 100],
    // Resolved inside the 28-day window on purpose. Everything above was finished or abandoned
    // months ago, which left the abandonment rate and the reasons list permanently empty in dev —
    // a panel that renders only the null case is a panel nobody has seen work.
    ["article", "Yet another take on eventual consistency", "abandoned", "too_shallow", 150],
    ["book", "Thinking in Systems", "finished", null, 120],
  ] as const;

  const created: Titled[] = [];
  for (const [type, title, status, abandonReason, offset] of specs) {
    const addedAt = new Date(`${addDays(from, offset)}T09:00:00.000Z`);
    const resource = await prisma.resource.create({
      data: {
        userId,
        type,
        title,
        status,
        abandonReason,
        addedAt,
        finishedAt:
          status === "finished" || status === "abandoned"
            ? new Date(
                `${addDays(from, Math.min(DAYS - 1, offset + r.between(14, 60)))}T18:00:00.000Z`,
              )
            : null,
        progress: progressFor(type, status, r),
      },
      select: { id: true, title: true },
    });
    created.push(resource);

    await prisma.resourceLink.create({
      data: {
        userId,
        resourceId: resource.id,
        missionId: missions[r.int(missions.length)]!.id,
        skillId: r.chance(0.6) ? skills[r.int(skills.length)]!.id : null,
      },
    });
  }

  void today;
  return created;
}

/**
 * The three actives that never receive a session, so they stall.
 *
 * Named rather than sliced off the end. It was `resources.slice(0, -3)`, and adding two entries to
 * the list at the bottom silently handed the intended three back to the session generator and
 * un-stalled them — the backlog signal needs three and quietly dropped to two. Titles are stable in
 * a way positions are not.
 */
const STALLED: ReadonlySet<string> = new Set([
  "The Sense of Style",
  "In Search of an Understandable Consensus Algorithm",
  "MIT 6.824",
]);

function progressFor(type: string, status: string, r: Random): object {
  const unit =
    type === "book" ? "page" : type === "video" || type === "podcast" ? "second" : "percent";
  const total =
    unit === "page" ? r.between(180, 740) : unit === "second" ? r.between(900, 7200) : 100;
  const fraction =
    status === "finished" ? 1 : status === "inbox" || status === "queued" ? 0 : r.int(80) / 100;
  return { unit, current: Math.round(total * fraction), total };
}

/**
 * Which days had a session.
 *
 * Three shaping rules, each of which makes a specific insight real:
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
  skills: readonly Named[],
  resources: readonly Titled[],
  tz: string,
  r: Random,
): Promise<number> {
  // The parked mission stops receiving sessions two thirds of the way in, which is what makes it
  // look parked in the history rather than merely flagged as such.
  const workedOn = missions.slice(0, 3);
  const touchable = resources.filter((resource) => !STALLED.has(resource.title));
  // The writing mission goes quiet for the last three weeks while staying *active*, which is
  // exactly what stall detection is for (FR-N3) — and what the third seeded weekly review says it
  // decided to do something about. Without it the nudge has nothing to fire on in dev, and a
  // notification nobody has ever seen rendered is one nobody has checked the copy of.
  const quietFrom = activeDays.at(-1) === undefined ? null : addDays(activeDays.at(-1)!, -20);
  let count = 0;

  for (const day of activeDays) {
    const stillWorkedOn = quietFrom !== null && day >= quietFrom ? workedOn.slice(0, 2) : workedOn;
    const blocks = r.chance(0.28) ? 2 : 1;
    for (let block = 0; block < blocks; block += 1) {
      const hour = block === 0 ? r.between(8, 11) : r.between(19, 21);
      const minutes = r.pick([25, 30, 40, 45, 50, 60, 75, 90]);
      const startedAt = at(day, hour, r.pick([0, 15, 30]), tz);
      const hit = r.pick(["yes", "yes", "yes", "partly", "partly", "no"]);

      const session = await prisma.focusSession.create({
        data: {
          userId,
          missionId: r.pick(stillWorkedOn).id,
          skillId: r.chance(0.7) ? r.pick(skills).id : null,
          resourceId: r.chance(0.75) ? r.pick(touchable).id : null,
          intention: r.pick(INTENTIONS),
          startedAt,
          endedAt: new Date(startedAt.getTime() + minutes * 60_000),
          hitIntention: hit,
          focusQuality: r.between(2, 5),
          energy: r.between(2, 5),
          entryMode: r.chance(0.18) ? "backfilled" : "timer",
        },
        select: { id: true },
      });
      count += 1;

      // A third of sessions log nothing. That is the case that contributes to focus minutes and to
      // neither ember nor slag, and every screen has to handle it.
      const events = r.chance(0.34) ? 0 : r.between(1, 3);
      for (let i = 0; i < events; i += 1) {
        await prisma.frictionEvent.create({
          data: {
            userId,
            sessionId: session.id,
            type: r.pick(FRICTION_TABLE),
            intensity: r.pick([2, 3, 3, 3, 4, 4, 5]),
            skillId: r.chance(0.4) ? r.pick(skills).id : null,
            occurredAt: new Date(startedAt.getTime() + r.between(2, minutes - 1) * 60_000),
          },
        });
      }
    }
  }
  return count;
}

async function seedNotes(
  prisma: ReturnType<typeof connect>,
  userId: string,
  activeDays: readonly IsoDate[],
  missions: readonly Named[],
  skills: readonly Named[],
  tz: string,
  r: Random,
): Promise<number> {
  const bodies = [
    "A `&mut` is not a mutable reference, it is an *exclusive* one. That framing fixed most of my errors.",
    "Raft's leader election is easier to hold in my head than Paxos because the roles are named.",
    "Every paragraph I cut made the argument stronger. Suspicious pattern.",
    "The borrow checker is not stopping me writing this — it is telling me I have not decided who owns it.",
    "Quorum reads and quorum writes overlap by at least one node. That is the whole trick.",
    "I keep opening the async chapter and closing it. Probably a prerequisite gap, not a hard chapter.",
    "Wrote the summary first and the section second. Much faster, much shorter.",
    "Clock skew is not an edge case, it is the normal state of a distributed system.",
  ];

  let count = 0;
  for (const day of activeDays) {
    if (!r.chance(0.42)) continue;
    const onSkill = r.chance(0.55);
    await prisma.note.create({
      data: {
        userId,
        subjectType: onSkill ? "skill" : "mission",
        subjectId: onSkill ? r.pick(skills).id : r.pick(missions).id,
        body: r.pick(bodies),
        lang: "english",
        createdAt: at(day, r.between(9, 22), r.int(60), tz),
      },
    });
    count += 1;
  }
  return count;
}

async function seedPlanning(
  prisma: ReturnType<typeof connect>,
  userId: string,
  missions: readonly Named[],
  skills: readonly Named[],
  today: IsoDate,
  r: Random,
): Promise<{ plans: number; reviews: number }> {
  const thisWeek = startOfWeek(today, 0);
  let plans = 0;

  // Fourteen weeks of plans, each assuming about five hours across three subjects — comfortably
  // more than the history delivers, which is what makes plan-vs-actual worth looking at and what
  // fires the grid's `pace_below_plan` line.
  for (let week = 13; week >= 0; week -= 1) {
    const weekStart = addDays(thisWeek, -week * 7);
    const plan = await prisma.weeklyPlan.create({
      data: { userId, weekStart: new Date(`${weekStart}T00:00:00.000Z`) },
      select: { id: true },
    });
    plans += 1;

    await prisma.weeklyAllocation.createMany({
      data: [
        {
          userId,
          planId: plan.id,
          missionId: missions[0]!.id,
          plannedMinutes: r.pick([180, 240, 300]),
        },
        {
          userId,
          planId: plan.id,
          missionId: missions[1]!.id,
          plannedMinutes: r.pick([90, 120, 150]),
        },
        {
          userId,
          planId: plan.id,
          skillId: skills[r.int(4)]!.id,
          plannedMinutes: r.pick([45, 60, 90]),
        },
      ],
    });
  }

  // Three completed reviews, which is exactly M2's finish line — "you've done three weekly reviews
  // and changed one thing because of one". Seeing it satisfied in dev is how you find out whether
  // the screen that reports it says anything worth reading.
  const changes = [
    "Mornings only. Every evening block this month went nowhere.",
    "Dropping the Raft paper until I have finished DDIA's replication chapter.",
    "Two missions, not three. The writing one is not getting time and pretending otherwise is noise.",
  ];
  for (let i = 0; i < 3; i += 1) {
    const weekStart = addDays(thisWeek, -(i + 1) * 7);
    await prisma.weeklyReview.create({
      data: {
        userId,
        weekStart: new Date(`${weekStart}T00:00:00.000Z`),
        completedAt: new Date(`${addDays(weekStart, 6)}T21:00:00.000Z`),
        changedOneThing: changes[i]!,
      },
    });
  }

  return { plans, reviews: 3 };
}

await main();
