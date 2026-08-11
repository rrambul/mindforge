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
  RunAlreadyActive,
  RunTransitionInvalid,
  WorkspaceKeyUnavailable,
} from "../domain/errors.js";
import type { MissionWorkspace, MissionWorkspaceReader } from "./teach.port.js";
import { TeachRuns } from "./teach.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISSION = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-08T12:00:00.000Z");

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
  let teach: TeachRuns;

  beforeEach(() => {
    runs = new FakeRuns();
    missions = new FakeMissions();
    clock = new FixedClock(NOW);
    teach = new TeachRuns(runs, missions, clock, sequentialIds());
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
      const run = await teach.request(ALICE, MISSION);

      expect(run.status).toBe("queued");
      expect(run.kind).toBe("generate_lesson");
      // On the run as well as the mission, so the input says which prefix was
      // touched even if the mission is deleted later.
      expect(run.input).toEqual({ workspaceKey: "postgres-rls" });
    });

    it("refuses a mission that does not exist", async () => {
      await expect(teach.request(ALICE, "99999999-9999-4999-8999-999999999999")).rejects.toThrow(
        MissionNotFound,
      );
    });

    it("says a run is already active rather than queueing a second", async () => {
      await teach.request(ALICE, MISSION);
      await expect(teach.request(ALICE, MISSION)).rejects.toThrow(RunAlreadyActive);
    });

    it("assigns a workspace key to a mission that has never been taught", async () => {
      missions.missions.set(MISSION, {
        missionId: MISSION,
        topic: "Postgres RLS",
        status: "active",
        workspaceKey: null,
        hasCurriculum: true,
      });

      const run = await teach.request(ALICE, MISSION);

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

      const run = await teach.request(ALICE, MISSION);

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

      await expect(teach.request(ALICE, MISSION)).rejects.toThrow(WorkspaceKeyUnavailable);
    });
  });

  describe("get", () => {
    it("finds a run, and reports one that is not there", async () => {
      const run = await teach.request(ALICE, MISSION);

      await expect(teach.get(ALICE, run.id)).resolves.toMatchObject({ id: run.id });
      await expect(teach.get(BOB, run.id)).rejects.toThrow(AgentRunNotFound);
    });
  });

  describe("finish", () => {
    it("moves a claimed run to a terminal status", async () => {
      const run = await teach.request(ALICE, MISSION);
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
      const run = await teach.request(ALICE, MISSION);

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
      const run = await teach.request(ALICE, MISSION);
      await teach.claim(ALICE, run.id);

      clock.advance(HEARTBEAT_TIMEOUT_MS + 60_000);
      const reaped = await teach.reapStale();

      expect(reaped.map((r) => r.id)).toEqual([run.id]);
      expect(reaped[0]!.status).toBe("failed");
      // And the mission is free again — the whole point of the reaper.
      await expect(teach.request(ALICE, MISSION)).resolves.toMatchObject({ status: "queued" });
    });

    it("leaves a run alone while its heartbeat is fresh", async () => {
      const run = await teach.request(ALICE, MISSION);
      await teach.claim(ALICE, run.id);
      clock.advance(HEARTBEAT_TIMEOUT_MS - 1_000);
      await teach.heartbeat(ALICE, run.id);

      clock.advance(HEARTBEAT_TIMEOUT_MS - 1_000);
      await expect(teach.reapStale()).resolves.toEqual([]);
    });
  });

  describe("heartbeat", () => {
    it("reports false once the run is no longer running, so the worker aborts", async () => {
      const run = await teach.request(ALICE, MISSION);
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

    return new TeachRuns(new FakeRuns(), missions, new FixedClock(NOW), sequentialIds());
  }

  it("plans the curriculum when the mission has no modules", async () => {
    expect((await withCurriculum(false).request(ALICE, MISSION)).kind).toBe("generate_curriculum");
  });

  it("teaches a lesson once there are modules", async () => {
    expect((await withCurriculum(true).request(ALICE, MISSION)).kind).toBe("generate_lesson");
  });

  it("still takes an explicit kind, which nothing in the app sends", async () => {
    const run = await withCurriculum(false).request(ALICE, MISSION, "generate_lesson");
    expect(run.kind).toBe("generate_lesson");
  });
});
