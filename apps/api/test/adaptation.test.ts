import {
  CurriculumViewSchema,
  EXERCISE_SCRIPT_TYPE,
  type ExerciseDeclaration,
} from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import { renderBriefing } from "@mindforge/workspace";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  BRIEFING_READER,
  type BriefingReader,
} from "../src/modules/teach/application/briefing.port.js";
import { ReindexWorkspace } from "../src/modules/teach/application/reindex-workspace.js";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Difficulty adaptation, over the real stack (FR-D1–D4).
 *
 * The derivation is unit-tested in `packages/core`; what only the stack can show
 * is that the three readers of it agree. The curriculum screen, the next run's
 * briefing and the bridge endpoint each gather their own rows, and the whole
 * promise of Phase 3 is that what the screen says the next lesson will do is what
 * the run is told to do — and what the button is allowed to ask for.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let missionId: string;
let hardId: string;

const EXERCISE: ExerciseDeclaration = {
  key: "commit-index",
  kind: "code",
  language: "typescript",
  title: "Which entries are committed?",
  prompt: "Return the highest index on a majority.",
  starter: "",
  tests: 'test("x", () => expect(1).toBe(1));',
  solution: null,
  expectedMinutes: 10,
};

const curriculum = async () => {
  const response = await app.inject({
    method: "GET",
    url: `/v1/missions/${missionId}/curriculum`,
    headers: bearer(alice),
  });
  expect(response.statusCode).toBe(200);
  return CurriculumViewSchema.parse(response.json());
};

const lessonIn = (view: Awaited<ReturnType<typeof curriculum>>, slug: string) =>
  view.modules.flatMap((m) => m.lessons).find((l) => l.slug === slug)!;

const briefing = () =>
  app.get<BriefingReader>(BRIEFING_READER, { strict: false }).gather(alice.id, missionId);

beforeAll(async () => {
  app = await bootApp();
  db = adminDb();
  alice = await signUp();
});

afterAll(async () => {
  await deleteUsers(db, [alice.id]);
  await app.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`delete from missions where user_id = $1::uuid`, alice.id);

  const [mission] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into missions (id, user_id, topic, status, workspace_key, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, 'Raft', 'active', 'raft', now(), now()) returning id`,
    alice.id,
  );
  missionId = mission!.id;
  const [track] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into tracks (id, user_id, mission_id, slug, name, position, status, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, 'replication', 'Replication', 1, 'active', now(), now())
     returning id`,
    alice.id,
    missionId,
  );

  // Finished, marked shaky, and the exercise was tried twice and never passed.
  const [hard] = await db.$queryRawUnsafe<{ id: string }[]>(
    `insert into lessons (id, user_id, mission_id, track_id, status, seq, slug, title, storage_path,
       content_hash, exercises, completed_at, outcome, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'generated', 1, 'commit-index',
       'Which entries are committed?', 'lessons/0001-commit-index.html', 'sha', $4::jsonb,
       now(), 'shaky', now(), now())
     returning id`,
    alice.id,
    missionId,
    track!.id,
    JSON.stringify([EXERCISE]),
  );
  hardId = hard!.id;
  for (const minute of [1, 2]) {
    await db.$executeRawUnsafe(
      `insert into exercise_attempts (user_id, lesson_id, exercise_key, code, status, results,
         tests_passed, tests_total, passed, created_at)
       values ($1::uuid, $2::uuid, 'commit-index', 'x', 'completed', '[]', 0, 1, false,
         now() - make_interval(mins => $3::int))`,
      alice.id,
      hardId,
      minute,
    );
  }
});

describe("a lesson that landed too hard", () => {
  it("says so on the curriculum, with the reason, and announces a bridge", async () => {
    const view = await curriculum();

    expect(lessonIn(view, "commit-index").strain).toEqual({
      verdict: "too-hard",
      reasons: ["never-passed"],
    });
    expect(view.upcoming).toEqual({
      kind: "bridge",
      lessonId: hardId,
      title: "Which entries are committed?",
    });
  });

  it("is what the next run's briefing asks for, with the tags to write", async () => {
    const facts = await briefing();

    expect(facts.lessonLandings).toEqual([
      "0001 Which entries are committed? — too-hard: they tried the exercise and never passed it",
    ]);
    const rendered = renderBriefing({ ...facts, kind: "generate_lesson" });
    expect(rendered).toContain('<meta name="mindforge:bridge-for" content="commit-index">');
    expect(rendered).toContain('<meta name="mindforge:track" content="replication">');
  });

  it("can be sent for an easier version, which queues a lesson run naming it", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/lessons/${hardId}/bridge`,
      headers: bearer(alice),
    });

    expect(response.statusCode).toBe(202);
    const [run] = await db.$queryRawUnsafe<{ kind: string; input: Record<string, unknown> }[]>(
      `select kind, input from agent_runs where mission_id = $1::uuid`,
      missionId,
    );
    expect(run).toMatchObject({ kind: "generate_lesson", input: { bridgeFor: hardId } });

    // The dispatcher passes the run's target to the briefing, which asks for it by
    // name and says the learner asked.
    const asked = await app
      .get<BriefingReader>(BRIEFING_READER, { strict: false })
      .gather(alice.id, missionId, { bridgeFor: hardId });
    expect(renderBriefing({ ...asked, kind: "generate_lesson" })).toContain(
      "The learner asked for an easier version",
    );
  });

  it("gets one bridge, not one per press, once the bridge lesson exists", async () => {
    // The bridge arrives the way a real run's does: a file, through the reindexer.
    const bridgeHtml = `<html><head><title>One step smaller</title>
      <meta name="mindforge:track" content="replication">
      <meta name="mindforge:adjusted" content="bridge">
      <meta name="mindforge:bridge-for" content="commit-index">
      <meta name="mindforge:adjusted-reason" content="You never passed the commit-index exercise.">
      </head><body><p>A smaller step.</p>
      <script type="${EXERCISE_SCRIPT_TYPE}">${JSON.stringify({ ...EXERCISE, key: "majority" })}</script>
      </body></html>`;
    await app.get(ReindexWorkspace, { strict: false }).execute({
      userId: alice.id,
      missionId,
      files: new Map([
        ["lessons/0002-one-step-smaller.html", new TextEncoder().encode(bridgeHtml)],
      ]),
      deleted: [],
      timezone: "UTC",
    });

    const view = await curriculum();
    const bridge = lessonIn(view, "one-step-smaller");
    expect(bridge.adjustment).toEqual({
      kind: "bridge",
      reason: "You never passed the commit-index exercise.",
      bridgeFor: { id: hardId, title: "Which entries are committed?" },
    });
    expect(lessonIn(view, "commit-index").bridge).toEqual({
      id: bridge.id,
      title: "One step smaller",
    });
    // Still the newest judged lesson, still too hard — and not bridged twice.
    expect(view.upcoming).toEqual({ kind: "as-planned" });

    const again = await app.inject({
      method: "POST",
      url: `/v1/lessons/${hardId}/bridge`,
      headers: bearer(alice),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ type: string }>().type).toMatch(/bridge-not-needed$/u);
  });
});

describe("a lesson that landed fine", () => {
  it("is not offered an easier version", async () => {
    await db.$executeRawUnsafe(
      `update exercise_attempts set passed = true, tests_passed = 1 where lesson_id = $1::uuid`,
      hardId,
    );

    expect((await curriculum()).upcoming).toEqual({ kind: "as-planned" });
    const response = await app.inject({
      method: "POST",
      url: `/v1/lessons/${hardId}/bridge`,
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(409);
  });

  it("is not judged at all before it is finished", async () => {
    await db.$executeRawUnsafe(
      `update lessons set completed_at = null, outcome = null where id = $1::uuid`,
      hardId,
    );

    const view = await curriculum();
    expect(lessonIn(view, "commit-index").strain).toEqual({
      verdict: null,
      unknown: "in-progress",
    });
    // Nothing judged is no signal — not "as planned".
    expect(view.upcoming).toBeNull();
    expect((await briefing()).lessonLandings).toEqual([]);
  });
});
