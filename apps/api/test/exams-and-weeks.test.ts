import { EXERCISE_SCRIPT_TYPE } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CurriculumView } from "../src/modules/curriculum/application/get-curriculum.js";
import {
  BRIEFING_READER,
  type BriefingReader,
} from "../src/modules/teach/application/briefing.port.js";
import { ReindexWorkspace } from "../src/modules/teach/application/reindex-workspace.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Exams and the week calendar, over HTTP, against the real database (FR-E1–E8,
 * FR-U1, FR-U4, FR-B1–B5).
 *
 * The failures this is here for are the quiet ones: an exam counted as a lesson, so
 * a module's fraction gains a denominator it can never finish; a lesson on the wrong
 * day of its week; a projection that guesses a pace it never measured. Each test
 * names the wrong answer.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;
let reindex: ReindexWorkspace;
let missionId: string;

const encoder = new TextEncoder();

const CURRICULUM = `# Curriculum

## Tracks

| Order | Slug      | Track     | Outcome          | Prerequisites |
| ----- | --------- | --------- | ---------------- | ------------- |
| 1     | ownership | Ownership | Move and borrow  | —             |
| 2     | traits    | Traits    | Write a trait    | ownership     |

## Module: ownership

| Slug      | Lesson    | Intent       | Difficulty | Depth   | Depends on |
| --------- | --------- | ------------ | ---------- | ------- | ---------- |
| moves     | Moves     | See a move   | 2          | working | —          |
| borrowing | Borrowing | Lend a value | 3          | working | moves      |

## Module: traits

| Slug   | Lesson | Intent      | Difficulty | Depth    | Depends on |
| ------ | ------ | ----------- | ---------- | -------- | ---------- |
| traits | Traits | Write one   | 3          | overview | borrowing  |
`;

function item(key: string, covers: readonly string[]): string {
  return `<script type="${EXERCISE_SCRIPT_TYPE}">${JSON.stringify({
    key,
    kind: "code",
    language: "javascript",
    title: key,
    prompt: "Do it.",
    starter: "",
    tests: 'import { f } from "./solution";',
    solution: "export const f = 1;",
    covers,
  })}</script>`;
}

const EXAM = `<html><head><title>Exam: Ownership</title>
<meta name="mindforge:kind" content="exam">
<meta name="mindforge:track" content="ownership">
</head><body><p>Two items, no hints.</p>
${item("move-it", ["moves"])}${item("lend-it", ["borrowing", "moves"])}
</body></html>`;

function request(
  method: "GET" | "PUT" | "POST",
  url: string,
  user: TestUser | null,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: user ? bearer(user) : {},
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function curriculum(user: TestUser = alice): Promise<CurriculumView> {
  const response = await request("GET", `/v1/missions/${missionId}/curriculum`, user);
  expect(response.statusCode).toBe(200);
  return response.json<CurriculumView>();
}

function moduleNamed(view: CurriculumView, slug: string) {
  const found = view.modules.find((m) => m.slug === slug);
  if (!found) throw new Error(`no module ${slug}`);
  return found;
}

/** The database's own UTC day, so no test reads the wall clock (the `new Date()` ban). */
async function todayUtc(offsetDays = 0): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ day: string }[]>(
    `select ((now() at time zone 'UTC')::date + $1::int)::text as day`,
    offsetDays,
  );
  return row!.day;
}

/** Write the planned lesson's file and finish it, `minutes` of focus bound to it. */
async function finish(slug: string, seq: number, minutes: number) {
  const [row] = await db.$queryRawUnsafe<{ id: string }[]>(
    `update lessons set status = 'generated', seq = $3::int,
       storage_path = 'lessons/000' || $3 || '-x.html', content_hash = 'sha',
       completed_at = now() - interval '1 day', outcome = 'understood'
     where mission_id = $1::uuid and slug = $2 returning id`,
    missionId,
    slug,
    seq,
  );
  if (minutes > 0) {
    await db.$executeRawUnsafe(
      `insert into focus_sessions (id, user_id, mission_id, lesson_id, started_at, ended_at, entry_mode)
       values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, now() - interval '2 days',
               now() - interval '2 days' + make_interval(mins => $4::int), 'timer')`,
      alice.id,
      missionId,
      row!.id,
      minutes,
    );
  }
}

async function writeExam() {
  await reindex.execute({
    userId: alice.id,
    missionId,
    files: new Map([
      ["CURRICULUM.md", encoder.encode(CURRICULUM)],
      ["lessons/0009-exam-ownership.html", encoder.encode(EXAM)],
    ]),
    deleted: [],
    timezone: "UTC",
  });
}

async function examId(): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ id: string }[]>(
    `select id from lessons where mission_id = $1::uuid and kind = 'exam'`,
    missionId,
  );
  return row!.id;
}

function attempt(lessonId: string, key: string, passed: boolean) {
  return request("POST", `/v1/lessons/${lessonId}/exercises/${key}/attempts`, alice, {
    code: "export const f = 1;",
    status: "completed",
    results: [{ name: "t", passed, message: passed ? null : "no" }],
  });
}

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
  bob = await signUp();
  reindex = app.get(ReindexWorkspace, { strict: false });
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);
  await db.$executeRawUnsafe(`delete from focus_sessions where user_id = $1::uuid`, alice.id);
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Rust', 'active', 'rust', now(), now())
     returning id`,
    alice.id,
  );
  missionId = rows[0]!.id;

  await reindex.execute({
    userId: alice.id,
    missionId,
    files: new Map([["CURRICULUM.md", encoder.encode(CURRICULUM)]]),
    deleted: [],
    timezone: "UTC",
  });
});

describe("an exam", () => {
  it("is not a lesson: the module's fraction does not count it (FR-E2)", async () => {
    await finish("moves", 1, 0);
    await finish("borrowing", 2, 0);
    await writeExam();

    const module = moduleNamed(await curriculum(), "ownership");

    expect(module.progress).toEqual({ completed: 2, total: 2 });
    expect(module.lessons.map((l) => l.slug)).toEqual(["moves", "borrowing"]);
    expect(module.exam).toMatchObject({
      title: "Exam: Ownership",
      result: { total: 2, passedCount: 0, attempted: false, passed: false },
    });
    // Lessons done, exam not passed: waiting on its exam, not finished (FR-E7).
    expect(module.finishedAt).toBeNull();
  });

  it("is null on a module with no exam written — not written, never failed", async () => {
    expect(moduleNamed(await curriculum(), "ownership").exam).toBeNull();
  });

  it("is queued by the teach button once a module's lessons are done (FR-E3)", async () => {
    await finish("moves", 1, 0);
    await finish("borrowing", 2, 0);

    const response = await request("POST", `/v1/missions/${missionId}/teach`, alice);

    expect(response.statusCode).toBe(202);
    expect(response.json<{ kind: string }>().kind).toBe("generate_exam");
    await db.$executeRawUnsafe(`delete from agent_runs where mission_id = $1::uuid`, missionId);
  });

  it("names the lessons an unpassed item covers, and finishes the module when all pass", async () => {
    await finish("moves", 1, 0);
    await finish("borrowing", 2, 0);
    await writeExam();
    const id = await examId();

    expect((await attempt(id, "move-it", true)).statusCode).toBe(201);
    expect((await attempt(id, "lend-it", false)).statusCode).toBe(201);

    let module = moduleNamed(await curriculum(), "ownership");
    expect(module.exam?.result).toMatchObject({ passedCount: 1, attempted: true, passed: false });
    expect(module.exam?.result?.revisit.map((lesson) => lesson.title)).toEqual([
      "Borrowing",
      "Moves",
    ]);

    await attempt(id, "lend-it", true);
    module = moduleNamed(await curriculum(), "ownership");
    expect(module.exam?.result).toMatchObject({ passed: true, revisit: [] });
    expect(module.finishedAt).not.toBeNull();
    expect(module.projection).toEqual({ status: "finished" });
  });

  it("refuses a hint before the item is passed, and an outcome chip at all (FR-E5)", async () => {
    await finish("moves", 1, 0);
    await finish("borrowing", 2, 0);
    await writeExam();
    const id = await examId();

    const hint = await request("POST", `/v1/lessons/${id}/exercises/move-it/hints`, alice, {
      level: 1,
      code: "",
    });
    expect(hint.statusCode).toBe(409);
    expect(hint.json<{ type: string }>().type).toContain("no-help-in-exam");

    const reveal = await request(
      "POST",
      `/v1/lessons/${id}/exercises/move-it/solution-reveals`,
      alice,
    );
    expect(reveal.statusCode).toBe(409);

    const chip = await request("PUT", `/v1/lessons/${id}/completion`, alice, {
      outcome: "understood",
    });
    expect(chip.statusCode).toBe(409);
    expect(chip.json<{ type: string }>().type).toContain("lesson-is-exam");
  });
});

describe("an exam run's briefing (FR-E4)", () => {
  it("names the module's lessons with the exercises the learner saw, and counts no exam", async () => {
    await finish("moves", 1, 0);
    await finish("borrowing", 2, 0);
    await db.$executeRawUnsafe(
      `update lessons set exercises = $2::jsonb where mission_id = $1::uuid and slug = 'moves'`,
      missionId,
      JSON.stringify([
        {
          key: "see-a-move",
          kind: "code",
          language: "javascript",
          title: "See a move",
          prompt: "p",
          starter: "",
          tests: 'import { f } from "./solution";',
        },
        // Written around the reindexer, and refused by the contract the panel reads.
        { key: "half-written", title: "Never shown" },
      ]),
    );
    await writeExam();
    const [track] = await db.$queryRawUnsafe<{ id: string }[]>(
      `select id from tracks where mission_id = $1::uuid and slug = 'ownership'`,
      missionId,
    );

    const facts = await app
      .get<BriefingReader>(BRIEFING_READER, { strict: false })
      .gather(alice.id, missionId, { examFor: track!.id });

    // Moves, borrowing and the planned traits lesson. The exam would make it four.
    expect(facts.lessonCount).toBe(3);
    expect(facts.examModule?.slug).toBe("ownership");
    expect(facts.examModule?.lessons.map((lesson) => [lesson.slug, lesson.exercises])).toEqual([
      ["moves", ["See a move"]],
      ["borrowing", []],
    ]);
  });
});

describe("the pace projection", () => {
  it("refuses to guess a pace it never measured (FR-U1)", async () => {
    const view = await curriculum();

    expect(view.pace).toEqual({
      status: "unknown",
      missing: ["timed-lessons", "recent-time"],
      timedLessons: 0,
    });
    expect(moduleNamed(view, "ownership").projection).toEqual({
      status: "unknown",
      reason: "no-pace",
    });
  });

  it("projects from the median of timed lessons and the 28-day pace, chained by module", async () => {
    // 28 + 30 + 32 focused minutes: a median of 30 a lesson, and 90 minutes over 28
    // days. Every lesson is done, so each module owes only its exam — one lesson's
    // worth, 30 minutes, at 90/28 a day: 9.33 days, then 18.67 days cumulative.
    await finish("moves", 1, 28);
    await finish("borrowing", 2, 30);
    await finish("traits", 3, 32);

    const view = await curriculum();

    expect(view.pace).toMatchObject({ status: "known", minutesPerLesson: 30, timedLessons: 3 });
    expect(moduleNamed(view, "ownership").projection).toEqual({
      status: "projected",
      units: 1,
      minutes: 30,
      startDay: await todayUtc(0),
      examDay: await todayUtc(9),
    });
    expect(moduleNamed(view, "traits").projection).toMatchObject({
      startDay: await todayUtc(9),
      examDay: await todayUtc(18),
    });
    // Ownership waits on its exam, so it is the module you are in.
    expect(view.currentModuleId).toBe(moduleNamed(view, "ownership").id);
  });
});

describe("a mission planned in weeks (FR-B1–B5)", () => {
  /** Plan the mission in `weeks` weeks from this week's start in Alice's profile. */
  async function planInWeeks(weeks: number): Promise<string> {
    const [row] = await db.$queryRawUnsafe<{ starts_on: string }[]>(
      `update missions m set weeks = $2::smallint,
              starts_on = (now() at time zone p.timezone)::date
                - ((extract(dow from (now() at time zone p.timezone))::int - p.week_starts_on + 7) % 7)
         from profiles p
        where m.id = $1::uuid and p.id = m.user_id
       returning m.starts_on::text as starts_on`,
      missionId,
      weeks,
    );
    // Re-indexed, as a curriculum run after creation would: that is where weeks are pinned.
    await reindex.execute({
      userId: alice.id,
      missionId,
      files: new Map([["CURRICULUM.md", encoder.encode(CURRICULUM)]]),
      deleted: [],
      timezone: "UTC",
    });
    return row!.starts_on;
  }

  it("puts module k on week k, its lessons on days 1–5 and its exam on day 6", async () => {
    const startsOn = await planInWeeks(2);
    const view = await curriculum();

    expect(view.calendar).toMatchObject({ weeks: 2, startsOn });
    const ownership = moduleNamed(view, "ownership");
    expect(ownership.week).toMatchObject({ index: 1, startsOn });
    expect(ownership.lessons.map((lesson) => lesson.dueOn)).toEqual([
      startsOn,
      await dayAfter(startsOn, 1),
    ]);
    expect(ownership.week?.examOn).toBe(await dayAfter(startsOn, 5));
    expect(moduleNamed(view, "traits").week?.index).toBe(2);
  });

  it("keeps every module's week when a revision drops one — no date moves (FR-B4)", async () => {
    await planInWeeks(2);
    const before = moduleNamed(await curriculum(), "traits").week;

    // The revision drops the first module and keeps the second.
    const revised = CURRICULUM.replace(/\| 1 +\| ownership[^\n]*\n/u, "").replace(
      /## Module: ownership[\s\S]*?(?=## Module: traits)/u,
      "",
    );
    await reindex.execute({
      userId: alice.id,
      missionId,
      files: new Map([["CURRICULUM.md", encoder.encode(revised)]]),
      deleted: [],
      timezone: "UTC",
    });

    const after = await curriculum();
    expect(moduleNamed(after, "traits").week).toMatchObject({
      index: 2,
      startsOn: before!.startsOn,
    });
  });

  it("tells a lesson run the day the screen shows", async () => {
    await planInWeeks(2);
    const view = await curriculum();
    const next = view.modules.flatMap((m) => m.lessons).find((l) => l.id === view.nextLessonId)!;

    const facts = await app
      .get<BriefingReader>(BRIEFING_READER, { strict: false })
      .gather(alice.id, missionId);

    expect(facts.calendar?.lesson).toEqual({ week: 1, day: 1, date: next.dueOn });
  });

  it("has no calendar for a mission from before weeks", async () => {
    const view = await curriculum();

    expect(view.calendar).toBeNull();
    expect(moduleNamed(view, "ownership").week).toBeNull();
  });

  it("indexes a plan off its weeks, and says what is off (FR-B2)", async () => {
    await planInWeeks(2);
    const result = await reindex.execute({
      userId: alice.id,
      missionId,
      files: new Map([["CURRICULUM.md", encoder.encode(CURRICULUM)]]),
      deleted: [],
      timezone: "UTC",
    });

    // Two modules for two weeks, with two and one lessons rather than five.
    expect(result.warnings).toContainEqual({
      code: "curriculum_off_weeks",
      args: { weeks: 2, modules: 2, offModules: "1, 2" },
      path: "CURRICULUM.md",
    });
  });
});

async function dayAfter(day: string, days: number): Promise<string> {
  const [row] = await db.$queryRawUnsafe<{ day: string }[]>(
    `select ($1::date + $2::int)::text as day`,
    day,
    days,
  );
  return row!.day;
}
