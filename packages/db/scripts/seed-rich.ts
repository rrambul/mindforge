import {
  addDays,
  dayOfWeek,
  eachDay,
  ExerciseDeclarationSchema,
  type ExerciseDeclaration,
  type IsoDate,
} from "@mindforge/core";
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
import {
  lessonHtml,
  referenceHtml,
  stylesheet,
  workspaceUploader,
  type WorkspaceUploader,
} from "./seed-workspace.js";

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

/**
 * Exercises, by lesson slug (FR-X1).
 *
 * One, on a finished lesson in the distributed-systems curriculum, and a real
 * one: the runner executes these tests, so a seed whose solution did not pass them
 * would be a reader that tells every developer their correct code is wrong. Parsed
 * through the contract here so a seed that drifted from it fails at seed time
 * rather than as an exercise panel that silently renders nothing.
 */
const EXERCISES: Readonly<Record<string, readonly ExerciseDeclaration[]>> = {
  "moves-and-copies": [
    ExerciseDeclarationSchema.parse({
      key: "longest-word",
      kind: "task",
      language: "rust",
      title: "Borrow, don't move",
      prompt:
        "longest_word takes a String and returns its longest word — and the test then uses the original String again, so the function must not take ownership of it.\n\n" +
        "Change the signature and the body until cargo test passes. The fix is in the types, not in cloning.",
      files: [
        {
          path: "Cargo.toml",
          contents: '[package]\nname = "borrowing"\nversion = "0.1.0"\nedition = "2021"\n',
        },
        {
          path: "src/lib.rs",
          contents:
            'pub fn longest_word(text: String) -> String {\n    text.split_whitespace().max_by_key(|w| w.len()).unwrap_or("").to_string()\n}\n',
        },
        {
          path: "tests/longest_word.rs",
          contents: [
            "use borrowing::longest_word;",
            "",
            "#[test]",
            "fn finds_the_longest_word_and_leaves_the_text_usable() {",
            '    let text = String::from("borrow the value not the ownership");',
            '    assert_eq!(longest_word(&text), "ownership");',
            "    assert_eq!(text.len(), 34);",
            "}",
            "",
          ].join("\n"),
        },
      ],
      command: "cargo test",
      solution:
        'pub fn longest_word(text: &str) -> &str {\n    text.split_whitespace().max_by_key(|w| w.len()).unwrap_or("")\n}\n',
      expectedMinutes: 10,
    }),
  ],
  "clocks-and-ordering": [
    ExerciseDeclarationSchema.parse({
      key: "lamport-receive",
      kind: "code",
      language: "python",
      title: "A Lamport clock, on receive",
      prompt:
        "A process keeps a Lamport clock. When a message arrives it carries the sender's clock.\n\n" +
        "Write on_receive(local, received) returning the process's clock after it handles the message.",
      starter: "def on_receive(local: int, received: int) -> int:\n    return local\n",
      tests: [
        "from solution import on_receive",
        "",
        "def test_a_message_from_the_future_moves_the_clock_past_it():",
        "    assert on_receive(3, 7) == 8",
        "",
        "def test_a_message_from_the_past_still_ticks_the_clock():",
        "    assert on_receive(9, 2) == 10",
        "",
        "def test_equal_clocks_tick_once():",
        "    assert on_receive(5, 5) == 6",
        "",
      ].join("\n"),
      solution:
        "def on_receive(local: int, received: int) -> int:\n    return max(local, received) + 1\n",
      expectedMinutes: 5,
    }),
  ],
  "network-is-not-reliable": [
    ExerciseDeclarationSchema.parse({
      key: "charge-once",
      kind: "whiteboard",
      title: "Charge exactly once",
      prompt:
        "A checkout service calls a payment provider over the network. Sometimes the call times out and nobody knows whether the charge happened.\n\n" +
        "Draw the services and the calls between them so that a customer is never charged twice, even when the network drops a response and the client retries.",
      rubric: [
        "The client sends an idempotency key with every charge request, and reuses it on retry",
        "The payment side stores the key with the result, so a repeated key returns the first result instead of charging again",
        "Calls to the provider have a timeout and a bounded retry, not an unbounded one",
        "An unknown outcome is resolved by asking the provider for the charge's status, not by charging again",
      ],
      solution:
        "Checkout → Payments service, carrying an idempotency key generated once per order. Payments looks the key up in its own store: a hit returns the stored result; a miss records the key as pending, calls the provider with a timeout, and stores the outcome. On a timeout it retries a bounded number of times with the same key, and if the outcome is still unknown it queries the provider's charge status before doing anything else.",
      expectedMinutes: 20,
    }),
  ],
  "leaders-and-followers": [
    ExerciseDeclarationSchema.parse({
      key: "commit-index",
      kind: "code",
      language: "typescript",
      title: "Which entries are committed?",
      prompt:
        "A leader tracks, for every node in the cluster (itself included), the highest log index that node has stored.\n\n" +
        "Write committedIndex(matchIndex) so it returns the highest index stored on a majority of the cluster — the entries the leader may safely apply. Return 0 when there is none.",
      starter: "export function committedIndex(matchIndex: number[]): number {\n  return 0;\n}\n",
      tests: [
        'import { committedIndex } from "./solution";',
        "",
        'test("a single node commits what it has", () => {',
        "  expect(committedIndex([7])).toBe(7);",
        "});",
        "",
        'test("three nodes need two copies", () => {',
        "  expect(committedIndex([5, 3, 1])).toBe(3);",
        "});",
        "",
        'test("five nodes need three copies", () => {',
        "  expect(committedIndex([9, 9, 4, 2, 2])).toBe(4);",
        "});",
        "",
        'test("an even cluster needs more than half", () => {',
        "  expect(committedIndex([6, 6, 1, 1])).toBe(1);",
        "});",
        "",
        'test("leaves the caller\'s array alone", () => {',
        "  const acks = [1, 5, 3];",
        "  committedIndex(acks);",
        "  expect(acks).toEqual([1, 5, 3]);",
        "});",
        "",
      ].join("\n"),
      solution: [
        "export function committedIndex(matchIndex: number[]): number {",
        "  const sorted = [...matchIndex].sort((a, b) => b - a);",
        "  const majority = Math.floor(sorted.length / 2) + 1;",
        "  return sorted[majority - 1] ?? 0;",
        "}",
        "",
      ].join("\n"),
      expectedMinutes: 10,
    }),
  ],
};

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

    // Best effort: the seed's one requirement is a database. Without Storage
    // credentials the rows are still written and the summary says which screen
    // will be empty, because a reader whose every lesson 404s looks broken while
    // the data is perfectly correct.
    const files = workspaceUploader();

    const missions = await seedMissions(prisma, userId, from);
    const finishedByMission = new Map<string, FinishedLesson[]>();
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
        files,
        finishedByMission,
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
        files,
        finishedByMission,
      ));

    const activeDays = chooseActiveDays(from, today, r);
    const sessionCount = await seedSessions(
      prisma,
      userId,
      activeDays,
      missions,
      tz,
      r,
      finishedByMission,
    );

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
        `  ${sessionCount} sessions on ${activeDays.length} days, ${rollup.daysWritten} rollup rows\n` +
        (files === null
          ? `  no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — no files written, so every lesson will 404 in the reader\n`
          : `  ${files.written} workspace files in Storage, so the reader has something to show\n`),
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
  files: WorkspaceUploader | null,
  finishedByMission: Map<string, FinishedLesson[]>,
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

  // Before any lesson, because every lesson links it — a workspace whose first
  // file is a lesson pointing at a stylesheet that is not there yet renders
  // unstyled for as long as the seed takes to finish.
  await files?.put(
    `workspaces/${userId}/${workspaceKey}/assets/lesson.css`,
    stylesheet(),
    "text/css; charset=utf-8",
  );

  const written: FinishedLesson[] = [];
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

      // Relative to the workspace, which is what the reindexer writes and what
      // the reader composes a view URL from. It used to be absolute here, and
      // that agreement between the seed and a wrong assumption in the reader is
      // why the first real teach run was the thing that found the mismatch.
      const storagePath = `lessons/${String(seq).padStart(4, "0")}-${slug}.html`;
      const intent = `What ${title.toLowerCase()} buys you.`;

      // The file first, so a row never points at a path that was never written.
      await files?.put(
        `workspaces/${userId}/${workspaceKey}/${storagePath}`,
        lessonHtml({
          title,
          trackSlug: spec.slug,
          lessonSlug: slug,
          intent,
          exercises: EXERCISES[slug] ?? [],
        }),
        "text/html; charset=utf-8",
      );

      const lesson = await prisma.lesson.create({
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
          intent,
          difficulty: Math.min(5, index + 1),
          depth: index === 0 ? "overview" : "working",
          position: index + 1,
          storagePath,
          contentHash: `seed-${workspaceKey}-${seq}`,
          // Written onto the row as the reindexer would from the file above.
          exercises: [...(EXERCISES[slug] ?? [])],
          completedAt,
          outcome,
        },
        select: { id: true },
      });

      // A record for every lesson that was actually finished, because that is when
      // the agent writes one — and a library with records for unread lessons would
      // be a library claiming work that never happened.
      if (outcome !== null) written.push({ id: lesson.id, title, outcome, day });
    }
  }

  finishedByMission.set(mission.id, written);
  await seedLibrary(prisma, userId, mission, workspaceKey, written, tz, files);

  await seedPlan(prisma, userId, mission, tracks, bySlug, tally);

  return tracks.length;
}

interface FinishedLesson {
  readonly id: string;
  readonly title: string;
  readonly outcome: "understood" | "shaky" | "lost";
  readonly day: IsoDate;
}

/**
 * What a mission leaves behind: one reference document, and a record per lesson
 * you actually finished (FR-T6).
 *
 * **Records only for finished lessons.** The agent writes one at the end of a
 * lesson, from what happened — a library holding records for lessons nobody opened
 * would be claiming work that never took place, which is the exact failure mode
 * non-negotiable 10 is about.
 *
 * **The struggles field is filled in for the shaky and lost ones.** A seed where
 * every record reads like a success is a seed that never shows the screen the case
 * it exists to render honestly.
 */
async function seedLibrary(
  prisma: ReturnType<typeof connect>,
  userId: string,
  mission: Named,
  workspaceKey: string,
  finished: readonly FinishedLesson[],
  tz: string,
  files: WorkspaceUploader | null,
): Promise<void> {
  const title = `${workspaceKey.replace(/-/gu, " ")} — the page to come back to`;
  const storagePath = "reference/quick-reference.html";

  await files?.put(
    `workspaces/${userId}/${workspaceKey}/${storagePath}`,
    referenceHtml(title, workspaceKey),
    "text/html; charset=utf-8",
  );

  await prisma.referenceDoc.create({
    data: {
      userId,
      missionId: mission.id,
      slug: "quick-reference",
      title,
      storagePath,
      contentHash: `seed-${workspaceKey}-reference`,
    },
  });

  // Mission-global sequence, like the filenames the skill writes.
  let seq = 0;
  for (const lesson of finished) {
    seq += 1;
    await prisma.learningRecord.create({
      data: {
        userId,
        missionId: mission.id,
        lessonId: lesson.id,
        seq,
        title: `${lesson.title} — what stuck`,
        whatLearned: `The part of "${lesson.title}" that actually landed, in your own words.`,
        evidence:
          lesson.outcome === "understood" ? "Rewrote it from scratch without looking." : null,
        keyInsight: lesson.outcome === "lost" ? null : "The rule underneath the rule.",
        struggles: lesson.outcome === "understood" ? null : "Could follow it reading, not writing.",
        next: `Redo this one before moving past it.`,
        storagePath: `learning-records/${String(seq).padStart(4, "0")}-record.md`,
        contentHash: `seed-${workspaceKey}-record-${seq}`,
        recordedAt: at(lesson.day, 22, 0, tz),
      },
    });
  }
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
  finishedByMission: ReadonlyMap<string, FinishedLesson[]>,
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
      const mission = r.pick(workedOn);

      await prisma.focusSession.create({
        data: {
          userId,
          missionId: mission.id,
          lessonId: boughtLesson(finishedByMission.get(mission.id) ?? [], day, r),
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

/**
 * What a block of attention bought (FR-F3).
 *
 * A session binds to a lesson finished within the next few days, which is the shape
 * a real one has: you spend the time, then you finish the thing. Most sessions bind
 * to nothing, and that is also real — the timer is started from Today more often
 * than from the reader, and binding is optional and never asked twice.
 */
function boughtLesson(finished: readonly FinishedLesson[], day: IsoDate, r: Random): string | null {
  const soon = finished.filter((lesson) => lesson.day >= day && lesson.day <= addDays(day, 3));
  if (soon.length === 0 || !r.chance(0.7)) return null;
  return r.pick(soon).id;
}

await main();
