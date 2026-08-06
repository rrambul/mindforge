import type { PrismaClient } from "@mindforge/db";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, bearer, bootApp, deleteUsers, signUp, type TestUser } from "./support/stack.js";

/**
 * Skills end to end (FR-S1..S6).
 *
 * The integration level earns its keep for three things: the `numeric` columns survive a round trip
 * without a self-rating leaking into `score`, the unique slug constraint behaves as the use case
 * assumes, and the cycle check reads the **stored** graph rather than one held in memory — which is
 * the only version of the check that matters.
 */

let app: NestFastifyApplication;
let db: PrismaClient;
let alice: TestUser;
let bob: TestUser;

interface SkillResponse {
  id: string;
  name: string;
  slug: string;
  perceivedLevel: number | null;
  score: number | null;
  band: string | null;
  feather: string;
  halfLifeDays: number;
  calibrationGap: number | null;
  calibrationVerdict: string | null;
  calibrationMissing: string | null;
  bandGap: number | null;
  prerequisiteIds: string[];
}

/**
 * The moment every relative date in this file is measured from.
 *
 * Taken once rather than per call: `NOW` in each helper would make two dates in one test
 * minutes apart on a slow run, and the decay assertions here are sensitive to the gap. The bare
 * constructor is also banned for the same underlying reason — see the Clock port.
 */
const NOW = new Date(Date.now());
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

function post(url: string, user: TestUser | null, payload?: object) {
  const headers = user ? bearer(user) : {};
  return payload === undefined
    ? app.inject({ method: "POST", url, headers })
    : app.inject({ method: "POST", url, headers, payload });
}

function patch(url: string, user: TestUser, payload: object) {
  return app.inject({ method: "PATCH", url, headers: bearer(user), payload });
}

function get(url: string, user: TestUser | null) {
  return app.inject({ method: "GET", url, headers: user ? bearer(user) : {} });
}

async function createSkill(user: TestUser, payload: object): Promise<SkillResponse> {
  const response = await post("/v1/skills", user, payload);
  expect(response.statusCode, response.body).toBe(201);
  return JSON.parse(response.body) as SkillResponse;
}

function listOf(response: { body: string }): SkillResponse[] {
  return (JSON.parse(response.body) as { skills: SkillResponse[] }).skills;
}

/** Writes a score directly, because nothing in M1 can produce one — evidence lands in M2. */
async function giveScore(id: string, score: number, lastEvidenceAt: Date): Promise<void> {
  await db.$executeRawUnsafe(
    `update skills set score = $2, last_evidence_at = $3 where id = $1::uuid`,
    id,
    score,
    lastEvidenceAt,
  );
}

beforeAll(async () => {
  db = adminDb();
  app = await bootApp();
  [alice, bob] = await Promise.all([signUp(), signUp()]);
});

afterAll(async () => {
  await deleteUsers(db, [alice.id, bob.id].filter(Boolean));
  await db.$disconnect();
  await app.close();
});

beforeEach(async () => {
  // Skills cascade to their edges and to any goal target pointing at them.
  await db.$executeRawUnsafe(`delete from skills where user_id = any($1::uuid[])`, [
    alice.id,
    bob.id,
  ]);
});

describe("creating a skill", () => {
  it("takes a name and starts unproven", async () => {
    // Null, never 0: "no evidence" and "evidence that you score zero" are different claims.
    const skill = await createSkill(alice, { name: "Rust ownership" });

    expect(skill.slug).toBe("rust-ownership");
    expect(skill.score).toBeNull();
    expect(skill.band).toBeNull();
    expect(skill.feather).toBe("vague");
  });

  it("records a self-rating without letting it become a score (FR-S2)", async () => {
    const skill = await createSkill(alice, { name: "Rust", perceivedLevel: 70 });

    expect(skill.perceivedLevel).toBe(70);
    expect(skill.score).toBeNull();

    // Proven in the database, because this is the invariant the whole feature rests on.
    const rows = await db.$queryRawUnsafe<{ score: unknown; perceived_level: unknown }[]>(
      `select score, perceived_level from skills where id = $1::uuid`,
      skill.id,
    );
    expect(rows[0]?.score).toBeNull();
    expect(Number(rows[0]?.perceived_level)).toBe(70);
  });

  it("ignores a score a client tries to send", async () => {
    const skill = await createSkill(alice, { name: "Rust", score: 95, band: "teaching" });
    expect(skill.score).toBeNull();
    expect(skill.band).toBeNull();
  });

  it("refuses a duplicate name with a 409 rather than a 500", async () => {
    await createSkill(alice, { name: "Rust" });
    const response = await post("/v1/skills", alice, { name: "Rust" });

    expect(response.statusCode).toBe(409);
    const problem = JSON.parse(response.body) as { errors: { field: string }[] };
    expect(problem.errors[0]?.field).toBe("name");
  });

  it("lets two users have the same skill name", async () => {
    await createSkill(alice, { name: "Rust" });
    await expect(createSkill(bob, { name: "Rust" })).resolves.toMatchObject({ name: "Rust" });
  });

  it("folds accents into the slug", async () => {
    // This user writes in Portuguese; `programacao` is the right answer, not `programao`.
    const skill = await createSkill(alice, { name: "Programação Funcional" });
    expect(skill.slug).toBe("programacao-funcional");
  });

  it("declares prerequisites at creation", async () => {
    const borrowing = await createSkill(alice, { name: "Borrowing" });
    const lifetimes = await createSkill(alice, {
      name: "Lifetimes",
      prerequisiteIds: [borrowing.id],
    });

    expect(lifetimes.prerequisiteIds).toEqual([borrowing.id]);
  });
});

describe("the DAG against a stored graph (FR-S1)", () => {
  async function chain(names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of names) ids.push((await createSkill(alice, { name })).id);
    for (let i = 0; i < ids.length - 1; i += 1) {
      const response = await post(`/v1/skills/${ids[i]}/prerequisites`, alice, {
        prereqId: ids[i + 1],
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    return ids;
  }

  it("refuses a skill requiring itself", async () => {
    const rust = await createSkill(alice, { name: "Rust" });
    const response = await post(`/v1/skills/${rust.id}/prerequisites`, alice, {
      prereqId: rust.id,
    });

    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as { type: string }).type).toContain("self-prerequisite");
  });

  it("refuses a transitive cycle read from the database", async () => {
    // A→B→C stored, then C→A. The check has to load the whole graph to see this, which is why the
    // repository hands back every edge rather than one skill's neighbours.
    const [a, , c] = await chain(["A", "B", "C"]);

    const response = await post(`/v1/skills/${c}/prerequisites`, alice, { prereqId: a });
    expect(response.statusCode).toBe(409);
    expect((JSON.parse(response.body) as { type: string }).type).toContain("prerequisite-cycle");
  });

  it("leaves the stored graph untouched when it refuses one", async () => {
    const [a, b] = await chain(["A", "B"]);
    await post(`/v1/skills/${b}/prerequisites`, alice, { prereqId: a });

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from skill_edges where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("allows a diamond", async () => {
    const a = await createSkill(alice, { name: "A" });
    const b = await createSkill(alice, { name: "B" });
    const c = await createSkill(alice, { name: "C" });
    const d = await createSkill(alice, { name: "D" });

    for (const [skill, prereq] of [
      [a.id, b.id],
      [a.id, c.id],
      [b.id, d.id],
      [c.id, d.id],
    ]) {
      const response = await post(`/v1/skills/${skill}/prerequisites`, alice, { prereqId: prereq });
      expect(response.statusCode, response.body).toBe(201);
    }
  });

  it("is idempotent when the same edge is added twice", async () => {
    // The primary key is (skill_id, prereq_id), so a retry is the same edge rather than a conflict a
    // client has to tell apart from a real one.
    const [a, b] = await chain(["A", "B"]);
    const again = await post(`/v1/skills/${a}/prerequisites`, alice, { prereqId: b });
    expect(again.statusCode).toBe(201);

    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from skill_edges where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("removes an edge", async () => {
    const [a, b] = await chain(["A", "B"]);

    const response = await app.inject({
      method: "DELETE",
      url: `/v1/skills/${a}/prerequisites/${b}`,
      headers: bearer(alice),
    });
    expect(response.statusCode).toBe(200);
    expect((JSON.parse(response.body) as SkillResponse).prerequisiteIds).toEqual([]);
  });

  it("takes the edges with the skill when it is deleted", async () => {
    const [, b] = await chain(["A", "B"]);

    await app.inject({ method: "DELETE", url: `/v1/skills/${b}`, headers: bearer(alice) });
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*) from skill_edges where user_id = $1::uuid`,
      alice.id,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it("cannot point at another user's skill", async () => {
    const alices = await createSkill(alice, { name: "A" });
    const bobs = await createSkill(bob, { name: "B" });

    expect(
      (await post(`/v1/skills/${alices.id}/prerequisites`, alice, { prereqId: bobs.id }))
        .statusCode,
    ).toBe(404);
  });

  it("orders the list so a prerequisite comes first", async () => {
    await chain(["Lifetimes", "Borrowing"]);
    expect(listOf(await get("/v1/skills", alice)).map((s) => s.name)).toEqual([
      "Borrowing",
      "Lifetimes",
    ]);
  });
});

describe("decay (FR-S4)", () => {
  it("reports the faded score, not the stored one", async () => {
    // "A skill you haven't touched in 6 months should visibly fade." The stored value is 80.
    const skill = await createSkill(alice, { name: "Rust" });
    const ninetyDaysAgo = daysAgo(90);
    await giveScore(skill.id, 80, ninetyDaysAgo);

    const read = JSON.parse((await get(`/v1/skills/${skill.id}`, alice)).body) as SkillResponse;
    expect(read.score).toBeGreaterThan(35);
    expect(read.score).toBeLessThan(45);
    // Which moves the band too, without anything having been written.
    expect(read.band).toBe("assisted");
  });

  it("goes back to unproven rather than reporting a sliver", async () => {
    const skill = await createSkill(alice, { name: "Rust" });
    await giveScore(skill.id, 80, daysAgo(5 * 365));

    const read = JSON.parse((await get(`/v1/skills/${skill.id}`, alice)).body) as SkillResponse;
    expect(read.score).toBeNull();
    expect(read.band).toBeNull();
  });

  it("feathers the gauge by how stale the evidence is", async () => {
    const skill = await createSkill(alice, { name: "Rust" });
    await giveScore(skill.id, 80, daysAgo(100));

    const read = JSON.parse((await get(`/v1/skills/${skill.id}`, alice)).body) as SkillResponse;
    expect(read.feather).toBe("vague");
  });

  it("filters by the decayed band, not a stored one", async () => {
    // Asking for "everything at Working" and getting a skill that was Working a year ago is exactly
    // the staleness FR-S4 exists to remove.
    const faded = await createSkill(alice, { name: "Faded" });
    const fresh = await createSkill(alice, { name: "Fresh" });
    await giveScore(faded.id, 80, daysAgo(90));
    await giveScore(fresh.id, 80, NOW);

    expect(listOf(await get("/v1/skills?band=fluent", alice)).map((s) => s.name)).toEqual([
      "Fresh",
    ]);
    expect(listOf(await get("/v1/skills?band=assisted", alice)).map((s) => s.name)).toEqual([
      "Faded",
    ]);
  });

  it("refuses a half-life that would switch decay off", async () => {
    const skill = await createSkill(alice, { name: "Rust" });
    expect(
      (await patch(`/v1/skills/${skill.id}`, alice, { halfLifeDays: 100_000 })).statusCode,
    ).toBe(422);
  });
});

describe("the calibration gap (FR-S5)", () => {
  it("reports overconfidence against the decayed score", async () => {
    const skill = await createSkill(alice, { name: "Rust", perceivedLevel: 90 });
    await giveScore(skill.id, 50, NOW);

    const read = JSON.parse((await get(`/v1/skills/${skill.id}`, alice)).body) as SkillResponse;
    expect(read.calibrationGap).toBeCloseTo(40, 0);
    expect(read.calibrationVerdict).toBe("overconfident");
    expect(read.bandGap).toBeGreaterThan(0);
  });

  it("reports no gap for a rated but undemonstrated skill", async () => {
    // The most interesting row in the table. Calling it perfectly calibrated would hide it.
    const skill = await createSkill(alice, { name: "Rust", perceivedLevel: 90 });

    const read = JSON.parse((await get(`/v1/skills/${skill.id}`, alice)).body) as SkillResponse;
    expect(read.calibrationGap).toBeNull();
    expect(read.calibrationVerdict).toBeNull();
    expect(read.calibrationMissing).toBe("score");
  });

  it("updates the rating without touching the score", async () => {
    const skill = await createSkill(alice, { name: "Rust" });
    await giveScore(skill.id, 50, NOW);

    const rated = JSON.parse(
      (await patch(`/v1/skills/${skill.id}/rating`, alice, { perceivedLevel: 95 })).body,
    ) as SkillResponse;

    expect(rated.perceivedLevel).toBe(95);
    expect(rated.score).toBeCloseTo(50, 0);

    // And in the database, because a rating write reaching `score` is the one thing that would make
    // this metric meaningless — the two terms would rise together by construction.
    const rows = await db.$queryRawUnsafe<{ score: unknown }[]>(
      `select score from skills where id = $1::uuid`,
      skill.id,
    );
    expect(Number(rows[0]?.score)).toBeCloseTo(50, 0);
  });

  it("filters to the overconfident skills", async () => {
    const over = await createSkill(alice, { name: "Overrated", perceivedLevel: 90 });
    const fine = await createSkill(alice, { name: "Honest", perceivedLevel: 50 });
    await giveScore(over.id, 40, NOW);
    await giveScore(fine.id, 50, NOW);

    expect(
      listOf(await get("/v1/skills?overconfidentOnly=true", alice)).map((s) => s.name),
    ).toEqual(["Overrated"]);
  });

  it("refuses a rating off the scale", async () => {
    const skill = await createSkill(alice, { name: "Rust" });
    expect(
      (await patch(`/v1/skills/${skill.id}/rating`, alice, { perceivedLevel: 150 })).statusCode,
    ).toBe(422);
  });
});

describe("a skill_band goal target reads this score (FR-M3b)", () => {
  it("becomes measurable once the skill has one", async () => {
    // The seam between the two features. In M1 a skill has no score, so the target reports
    // unmeasurable — and the moment one exists it starts measuring, with no code change.
    const skill = await createSkill(alice, { name: "Rust" });
    const goal = JSON.parse(
      (
        await post("/v1/goals", alice, {
          title: "Get fluent",
          targets: [
            { kind: "skill_band", skillId: skill.id, target: { band: "fluent" }, weight: 1 },
          ],
        })
      ).body,
    ) as { id: string; fraction: number | null; targets: { unmeasurable: string | null }[] };

    expect(goal.fraction).toBeNull();
    expect(goal.targets[0]?.unmeasurable).toBe("not_yet_implemented");

    await giveScore(skill.id, 75, NOW);
    const after = JSON.parse((await post(`/v1/goals/${goal.id}/recompute`, alice)).body) as {
      fraction: number | null;
      targets: { met: boolean }[];
    };

    expect(after.targets[0]?.met).toBe(true);
    expect(after.fraction).toBe(1);
  });

  it("un-meets the goal when the skill fades below the band", async () => {
    // FR-M3b end to end, through real decay rather than a stub.
    const skill = await createSkill(alice, { name: "Rust" });
    await giveScore(skill.id, 75, NOW);

    const goal = JSON.parse(
      (
        await post("/v1/goals", alice, {
          title: "Get fluent",
          targets: [
            { kind: "skill_band", skillId: skill.id, target: { band: "fluent" }, weight: 1 },
          ],
        })
      ).body,
    ) as { id: string; targets: { met: boolean }[] };
    expect(goal.targets[0]?.met).toBe(true);

    // Six months pass without retrieval. Nothing is written to the goal.
    await giveScore(skill.id, 75, daysAgo(180));

    const after = JSON.parse((await post(`/v1/goals/${goal.id}/recompute`, alice)).body) as {
      targets: { met: boolean; metAt: string | null }[];
    };
    expect(after.targets[0]?.met).toBe(false);
    expect(after.targets[0]?.metAt).toBeNull();
  });
});

describe("isolation", () => {
  it("cannot read, rate, or delete another user's skill", async () => {
    const bobs = await createSkill(bob, { name: "Bob's skill" });

    expect((await get(`/v1/skills/${bobs.id}`, alice)).statusCode).toBe(404);
    expect(
      (await patch(`/v1/skills/${bobs.id}/rating`, alice, { perceivedLevel: 10 })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/v1/skills/${bobs.id}`, headers: bearer(alice) }))
        .statusCode,
    ).toBe(404);

    const rows = await db.$queryRawUnsafe<{ name: string }[]>(
      `select name from skills where id = $1::uuid`,
      bobs.id,
    );
    expect(rows[0]?.name).toBe("Bob's skill");
  });

  it("never lists another user's skills", async () => {
    await createSkill(bob, { name: "Bob's skill" });
    expect(listOf(await get("/v1/skills", alice))).toEqual([]);
  });

  it("requires a token", async () => {
    expect((await get("/v1/skills", null)).statusCode).toBe(401);
    expect((await post("/v1/skills", null, { name: "x" })).statusCode).toBe(401);
  });
});
