import { FixedClock } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";

import type { IdGenerator } from "../../../shared/ids/id-generator.js";
import { MissionNotFound } from "../../missions/domain/errors.js";
import { HEARTBEAT_TIMEOUT_MS, type AgentRun, type AgentRunStatus } from "../domain/agent-run.js";
import type {
  AgentRunRepository,
  CreateAgentRun,
  FinishAgentRun,
} from "../domain/agent-run.repository.js";
import {
  AgentRunNotFound,
  DailyBudgetExhausted,
  RunAlreadyActive,
  RunTransitionInvalid,
  WorkspaceKeyUnavailable,
} from "../domain/errors.js";
import type { SpendReader } from "./spend.port.js";
import { TeachSpend } from "./teach-spend.js";
import type { MissionWorkspace, MissionWorkspaceReader } from "./teach.port.js";
import { TeachRuns } from "./teach.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-08T12:00:00.000Z");
/**
 * Passed on every `request` because the budget's day is the learner's, not the
 * server's (§5.2). UTC here so the window is the one the fixed clock sits inside.
 */
const TZ = "UTC";

class FakeRuns implements AgentRunRepository {
  readonly rows = new Map<string, AgentRun>();

  create(userId: string, run: CreateAgentRun): Promise<AgentRun | null> {
    // The partial unique index, in memory: one active run per mission.
    const active = [...this.rows.values()].some(
      (row) =>
        row.userId === userId &&
        row.missionId === run.missionId &&
        (row.status === "queued" || row.status === "running"),
    );
    if (active) return Promise.resolve(null);

    const created: AgentRun = {
      id: run.id,
      userId,
      missionId: run.missionId,
      kind: run.kind,
      status: "queued",
      input: run.input,
      result: null,
      error: null,
      createdAt: NOW,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    };
    this.rows.set(run.id, created);
    return Promise.resolve(created);
  }

  find(userId: string, id: string): Promise<AgentRun | null> {
    const run = this.rows.get(id);
    return Promise.resolve(run !== undefined && run.userId === userId ? run : null);
  }

  listForMission(userId: string, missionId: string, limit: number): Promise<AgentRun[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.userId === userId && row.missionId === missionId)
        .slice(0, limit),
    );
  }

  claim(userId: string, id: string, at: Date): Promise<AgentRun | null> {
    const run = this.rows.get(id);
    if (!run || run.userId !== userId || run.status !== "queued") return Promise.resolve(null);
    const claimed = { ...run, status: "running" as AgentRunStatus, startedAt: at };
    this.rows.set(id, claimed);
    return Promise.resolve(claimed);
  }

  heartbeat(userId: string, id: string, at: Date): Promise<boolean> {
    const run = this.rows.get(id);
    if (!run || run.userId !== userId || run.status !== "running") return Promise.resolve(false);
    this.rows.set(id, { ...run, heartbeatAt: at });
    return Promise.resolve(true);
  }

  finish(userId: string, id: string, at: Date, outcome: FinishAgentRun): Promise<AgentRun | null> {
    const run = this.rows.get(id);
    // The WHERE clause's half of the rule: only an active run can move.
    if (!run || run.userId !== userId || run.status === "succeeded" || run.status === "failed") {
      return Promise.resolve(null);
    }
    const finished: AgentRun = {
      ...run,
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
      finishedAt: at,
    };
    this.rows.set(id, finished);
    return Promise.resolve(finished);
  }

  findStale(before: Date, limit: number): Promise<AgentRun[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => {
          if (row.status !== "running") return false;
          const last = row.heartbeatAt ?? row.startedAt;
          return last === null || last < before;
        })
        .slice(0, limit),
    );
  }
}

class FakeMissions implements MissionWorkspaceReader {
  readonly missions = new Map<string, MissionWorkspace>();
  claimed: string | null = null;
  /** Simulates losing the claim race: the key some other run already wrote. */
  existingKey: string | null = null;

  find(_userId: string, missionId: string): Promise<MissionWorkspace | null> {
    return Promise.resolve(this.missions.get(missionId) ?? null);
  }

  takenKeys(): Promise<readonly string[]> {
    return Promise.resolve([...this.missions.values()].flatMap((m) => m.workspaceKey ?? []));
  }

  claimWorkspaceKey(_userId: string, _missionId: string, key: string): Promise<string> {
    this.claimed = key;
    return Promise.resolve(this.existingKey ?? key);
  }
}

/**
 * A spend reader that reports whatever the test needs today to have cost.
 *
 * Zero by default, so every case that is not about the budget behaves as it did
 * before the ceiling existed — a fake that quietly consumed budget would make the
 * unrelated cases fail in a way that pointed at the wrong feature.
 */
class FakeSpend implements SpendReader {
  usd = 0;
  unpricedCalls = 0;
  /** The window it was asked about, so a test can assert the day was the learner's. */
  window: { from: Date; to: Date } | null = null;

  inWindow(_userId: string, from: Date, to: Date) {
    this.window = { from, to };
    return Promise.resolve({
      usd: this.usd,
      pricedCalls: this.usd > 0 ? 1 : 0,
      unpricedCalls: this.unpricedCalls,
    });
  }
}

/** `TeachSpend` over a fake reader and a fixed cap. */
function spendWith(reader: SpendReader, capUsd: number | null, clock: FixedClock): TeachSpend {
  return new TeachSpend(reader, clock, { TEACH_DAILY_BUDGET_USD: capUsd } as never);
}

function sequentialIds(): IdGenerator {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    },
  };
}

describe("TeachRuns", () => {
  let runs: FakeRuns;
  let missions: FakeMissions;
  let clock: FixedClock;
  let spend: FakeSpend;
  let teach: TeachRuns;

  beforeEach(() => {
    runs = new FakeRuns();
    missions = new FakeMissions();
    clock = new FixedClock(NOW);
    spend = new FakeSpend();
    teach = new TeachRuns(runs, missions, clock, sequentialIds(), spendWith(spend, 15, clock));
    missions.missions.set(MISSION, {
      missionId: MISSION,
      topic: "Postgres RLS",
      status: "active",
      workspaceKey: "postgres-rls",
      hasCurriculum: true,
    });
  });

  describe("request", () => {
    it("queues a run and records which prefix it will touch", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);

      expect(run.status).toBe("queued");
      expect(run.kind).toBe("generate_lesson");
      // On the run as well as the mission, so the input says which prefix was
      // touched even if the mission is deleted later.
      expect(run.input).toEqual({ workspaceKey: "postgres-rls" });
    });

    it("refuses once today's budget is spent", async () => {
      // A teach run costs $1.47–$2.50 and is one button press, `MAX_BUDGET_USD`
      // bounds only a single run, and the single-active-run index is per mission —
      // so before this ceiling existed a learner with six missions had six runs'
      // worth in flight and no limit at all across a week.
      spend.usd = 15;

      await expect(teach.request(ALICE, MISSION, TZ)).rejects.toThrow(DailyBudgetExhausted);
    });

    it("names the cap in the error, so the message is not just 'try again later'", async () => {
      spend.usd = 20;

      await expect(teach.request(ALICE, MISSION, TZ)).rejects.toMatchObject({
        slug: "teach-daily-budget-exhausted",
        // `conflict`, not `forbidden`: nothing is wrong with the caller and they
        // may make exactly this request again at midnight.
        kind: "conflict",
        detailVars: { cap: "$15.00" },
      });
    });

    it("writes nothing when it refuses", async () => {
      // Checked before the insert, so a refusal costs one aggregate rather than a
      // queued row somebody has to clean up — and the mission does not end up
      // holding its single-active-run slot for a run that will never happen.
      spend.usd = 15;

      await expect(teach.request(ALICE, MISSION, TZ)).rejects.toThrow(DailyBudgetExhausted);
      expect(runs.rows.size).toBe(0);
    });

    it("checks the mission before the budget", async () => {
      // Otherwise a budget error on a mission that does not exist would confirm
      // that it does — the same reasoning that makes `AgentRunNotFound` a 404
      // rather than a 403.
      spend.usd = 15;

      await expect(
        teach.request(ALICE, "99999999-9999-4999-8999-999999999999", TZ),
      ).rejects.toThrow(MissionNotFound);
    });

    it("still teaches when the budget is merely close", async () => {
      spend.usd = 14.99;

      await expect(teach.request(ALICE, MISSION, TZ)).resolves.toMatchObject({ status: "queued" });
    });

    it("never lets unpriced calls exhaust the budget", async () => {
      // `cost_usd` is null when the model is not in the pricing table. Refusing on
      // those would mean telling a learner they had spent money nobody priced —
      // inventing a number in order to take something away (non-negotiable 10).
      spend.usd = 1;
      spend.unpricedCalls = 500;

      await expect(teach.request(ALICE, MISSION, TZ)).resolves.toMatchObject({ status: "queued" });
    });

    it("measures the learner's day, not the server's", async () => {
      // Every day in this product derives from the learner's IANA zone. A UTC
      // window would cut somebody's evening in half in São Paulo and hand somebody
      // in Auckland two allowances on a Tuesday.
      await teach.request(ALICE, MISSION, "Pacific/Auckland");

      // NOW is 2026-08-08T12:00Z, which is already the 9th in Auckland.
      expect(spend.window?.from.toISOString()).toBe("2026-08-08T12:00:00.000Z");
      expect(spend.window?.to.toISOString()).toBe("2026-08-09T12:00:00.000Z");
    });

    it("has no ceiling when the deployment configured none", async () => {
      // Absent is not zero. A cap of `null` means nobody set a limit; a cap of 0
      // means teaching is switched off, and those must not collapse into each
      // other.
      const uncapped = new TeachRuns(
        runs,
        missions,
        clock,
        sequentialIds(),
        spendWith(
          { inWindow: () => Promise.resolve({ usd: 9_999, pricedCalls: 1, unpricedCalls: 0 }) },
          null,
          clock,
        ),
      );

      await expect(uncapped.request(ALICE, MISSION, TZ)).resolves.toMatchObject({
        status: "queued",
      });
    });

    it("refuses everything when the cap is zero, which is a real setting", async () => {
      const off = new TeachRuns(
        runs,
        missions,
        clock,
        sequentialIds(),
        spendWith(new FakeSpend(), 0, clock),
      );

      await expect(off.request(ALICE, MISSION, TZ)).rejects.toThrow(DailyBudgetExhausted);
    });

    it("refuses a mission that does not exist", async () => {
      await expect(
        teach.request(ALICE, "99999999-9999-4999-8999-999999999999", TZ),
      ).rejects.toThrow(MissionNotFound);
    });

    it("says a run is already active rather than queueing a second", async () => {
      await teach.request(ALICE, MISSION, TZ);
      await expect(teach.request(ALICE, MISSION, TZ)).rejects.toThrow(RunAlreadyActive);
    });

    it("assigns a workspace key to a mission that has never been taught", async () => {
      missions.missions.set(MISSION, {
        missionId: MISSION,
        topic: "Postgres RLS",
        status: "active",
        workspaceKey: null,
        hasCurriculum: true,
      });

      const run = await teach.request(ALICE, MISSION, TZ);

      expect(missions.claimed).toBe("postgres-rls");
      expect(run.input).toEqual({ workspaceKey: "postgres-rls" });
    });

    it("uses the winner's key when the claim race was lost", async () => {
      // The loser reads back the winner's key instead of overwriting it — two
      // prefixes would split the learner's history in half.
      missions.missions.set(MISSION, {
        missionId: MISSION,
        topic: "Postgres RLS",
        status: "active",
        workspaceKey: null,
        hasCurriculum: true,
      });
      missions.existingKey = "rls-postgres";

      const run = await teach.request(ALICE, MISSION, TZ);

      expect(run.input).toEqual({ workspaceKey: "rls-postgres" });
    });

    it("reports when no workspace key can be derived at all", async () => {
      missions.missions.set(MISSION, {
        missionId: MISSION,
        topic: "!!!",
        status: "active",
        workspaceKey: null,
        hasCurriculum: true,
      });

      await expect(teach.request(ALICE, MISSION, TZ)).rejects.toThrow(WorkspaceKeyUnavailable);
    });
  });

  describe("get", () => {
    it("finds a run, and reports one that is not there", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);

      await expect(teach.get(ALICE, run.id)).resolves.toMatchObject({ id: run.id });
      await expect(teach.get(BOB, run.id)).rejects.toThrow(AgentRunNotFound);
    });
  });

  describe("finish", () => {
    it("moves a claimed run to a terminal status", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);
      await teach.claim(ALICE, run.id);

      const finished = await teach.finish(ALICE, run.id, {
        status: "succeeded",
        result: { turns: 26 },
        error: null,
      });

      expect(finished.status).toBe("succeeded");
      expect(finished.finishedAt).toEqual(NOW);
    });

    it("refuses a move the state machine forbids, and says why", async () => {
      // A late message from a reaped worker must be a loud conflict, not a silent
      // no-op — swallowing it is how a reaped run comes back to life.
      const run = await teach.request(ALICE, MISSION, TZ);

      await expect(
        teach.finish(ALICE, run.id, { status: "succeeded", result: null, error: null }),
      ).rejects.toThrow(RunTransitionInvalid);
    });

    it("reports a run that does not exist", async () => {
      await expect(
        teach.finish(ALICE, "99999999-9999-4999-8999-999999999999", {
          status: "failed",
          result: null,
          error: "x",
        }),
      ).rejects.toThrow(AgentRunNotFound);
    });
  });

  describe("reapStale", () => {
    it("fails a run whose worker stopped reporting", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);
      await teach.claim(ALICE, run.id);

      clock.advance(HEARTBEAT_TIMEOUT_MS + 60_000);
      const reaped = await teach.reapStale();

      expect(reaped.map((r) => r.id)).toEqual([run.id]);
      expect(reaped[0]!.status).toBe("failed");
      // And the mission is free again — the whole point of the reaper.
      await expect(teach.request(ALICE, MISSION, TZ)).resolves.toMatchObject({ status: "queued" });
    });

    it("leaves a run alone while its heartbeat is fresh", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);
      await teach.claim(ALICE, run.id);
      clock.advance(HEARTBEAT_TIMEOUT_MS - 1_000);
      await teach.heartbeat(ALICE, run.id);

      clock.advance(HEARTBEAT_TIMEOUT_MS - 1_000);
      await expect(teach.reapStale()).resolves.toEqual([]);
    });
  });

  describe("heartbeat", () => {
    it("reports false once the run is no longer running, so the worker aborts", async () => {
      const run = await teach.request(ALICE, MISSION, TZ);
      await teach.claim(ALICE, run.id);
      await teach.finish(ALICE, run.id, { status: "cancelled", result: null, error: null });

      await expect(teach.heartbeat(ALICE, run.id)).resolves.toBe(false);
    });
  });
});

/**
 * Which agent the button starts (FR-K1).
 *
 * Inferred from the mission, never sent by the client. The failure this rules out
 * is the one M4 exists to remove: a lesson taught against no curriculum, which
 * produces material with no plan to file it under and no fraction to move.
 */
describe("choosing the run kind", () => {
  function withCurriculum(hasCurriculum: boolean): TeachRuns {
    const missions = new FakeMissions();
    missions.missions.set(MISSION, {
      missionId: MISSION,
      topic: "Postgres RLS",
      status: "active",
      workspaceKey: "postgres-rls",
      hasCurriculum,
    });

    const clock = new FixedClock(NOW);
    return new TeachRuns(
      new FakeRuns(),
      missions,
      clock,
      sequentialIds(),
      spendWith(new FakeSpend(), 15, clock),
    );
  }

  it("plans the curriculum when the mission has no modules", async () => {
    expect((await withCurriculum(false).request(ALICE, MISSION, TZ)).kind).toBe(
      "generate_curriculum",
    );
  });

  it("teaches a lesson once there are modules", async () => {
    expect((await withCurriculum(true).request(ALICE, MISSION, TZ)).kind).toBe("generate_lesson");
  });

  it("still takes an explicit kind, which nothing in the app sends", async () => {
    const run = await withCurriculum(false).request(ALICE, MISSION, TZ, "generate_lesson");
    expect(run.kind).toBe("generate_lesson");
  });
});
