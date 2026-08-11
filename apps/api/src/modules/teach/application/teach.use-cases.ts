import { Inject, Injectable } from "@nestjs/common";

import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { MissionNotFound } from "../../missions/domain/errors.js";
import {
  canTransition,
  HEARTBEAT_TIMEOUT_MS,
  isStale,
  type AgentRun,
  type AgentRunKind,
} from "../domain/agent-run.js";
import {
  AGENT_RUN_REPOSITORY,
  type AgentRunRepository,
  type FinishAgentRun,
} from "../domain/agent-run.repository.js";
import {
  AgentRunNotFound,
  RunAlreadyActive,
  RunTransitionInvalid,
  WorkspaceKeyUnavailable,
} from "../domain/errors.js";
import { MISSION_WORKSPACE_READER, type MissionWorkspaceReader } from "./teach.port.js";
import { deriveWorkspaceKey } from "./workspace-key.js";

/**
 * The lifecycle of an agent run, shared by two processes.
 *
 * The API creates and reads; the worker claims, heartbeats, finishes and reaps.
 * They are the same use cases with different `UserScopedDb` implementations
 * behind them — `shared/persistence/user-scoped-db.ts` said in M2 that "the
 * service-role counterpart the worker needs lands with M3, implementing the same
 * interface so use cases are unaware of which one they have", and this is the
 * module that cashes that in.
 *
 * That is also why none of these methods reads an ambient user: the worker has no
 * request and no session, so `userId` is a parameter every time (non-negotiable
 * 1). It is what stands between a service-role connection and a cross-user leak.
 */
@Injectable()
export class TeachRuns {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY) private readonly runs: AgentRunRepository,
    @Inject(MISSION_WORKSPACE_READER) private readonly missions: MissionWorkspaceReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /**
   * Queue a run for a mission, assigning its workspace key if it has none.
   *
   * Returns 202-shaped data rather than waiting: §6 says long operations never
   * block a request, and a lesson takes minutes.
   *
   * **The kind is inferred, not chosen** (FR-K1). A mission with no modules needs
   * a plan before it needs a lesson, so the first press runs `curriculum` and
   * every press after it runs `teach`. Two reasons it is not a request field:
   * which skill runs is not a decision a browser should be able to make, and the
   * one button the learner sees means "do the next thing" — making them pick the
   * agent would be asking them to know the difference.
   *
   * A caller may still pass one explicitly; nothing in the app does.
   */
  async request(userId: string, missionId: string, kind?: AgentRunKind): Promise<AgentRun> {
    const mission = await this.missions.find(userId, missionId);
    if (!mission) throw new MissionNotFound(missionId);

    const resolved = kind ?? (mission.hasCurriculum ? "generate_lesson" : "generate_curriculum");

    const workspaceKey = await this.ensureWorkspaceKey(userId, mission);

    const run = await this.runs.create(userId, {
      id: this.ids.next(),
      missionId,
      kind: resolved,
      // The key is recorded on the run as well as on the mission, so a run's
      // input says which prefix it touched even if the mission is deleted later.
      input: { workspaceKey },
    });

    // `null` is the unique-index violation, not an error to rethrow: one active
    // run per mission is a product rule, and the honest answer to "teach me
    // something" while something is being taught is to say so.
    if (!run) throw new RunAlreadyActive(missionId);

    return run;
  }

  async get(userId: string, id: string): Promise<AgentRun> {
    const run = await this.runs.find(userId, id);
    if (!run) throw new AgentRunNotFound(id);
    return run;
  }

  listForMission(userId: string, missionId: string, limit = 20): Promise<AgentRun[]> {
    return this.runs.listForMission(userId, missionId, limit);
  }

  /**
   * Take a queued run, or find somebody else already took it.
   *
   * A compare-and-swap in SQL rather than a read-then-write, because two
   * dispatcher ticks are the case that matters and both would see `queued`.
   */
  claim(userId: string, id: string): Promise<AgentRun | null> {
    return this.runs.claim(userId, id, this.clock.now());
  }

  /**
   * Report liveness.
   *
   * `false` means the run is no longer running — reaped or cancelled underneath
   * the worker — and the caller must abort rather than carry on: its mission may
   * already belong to a newer run, and two agents syncing one workspace is the
   * corruption everything here is arranged to prevent.
   */
  heartbeat(userId: string, id: string): Promise<boolean> {
    return this.runs.heartbeat(userId, id, this.clock.now());
  }

  async finish(userId: string, id: string, outcome: FinishAgentRun): Promise<AgentRun> {
    const current = await this.runs.find(userId, id);
    if (!current) throw new AgentRunNotFound(id);

    // Checked here rather than left to the update's WHERE clause so the caller
    // learns *why* nothing moved. A late message from a reaped worker is a
    // conflict worth surfacing, not a silent no-op — swallowing it is how a
    // reaped run comes back to life and writes to a workspace it no longer owns.
    if (!canTransition(current.status, outcome.status)) {
      throw new RunTransitionInvalid(current.status, outcome.status);
    }

    const finished = await this.runs.finish(userId, id, this.clock.now(), outcome);
    if (!finished) throw new RunTransitionInvalid(current.status, outcome.status);
    return finished;
  }

  /**
   * Fail runs whose worker stopped reporting.
   *
   * The release the partial unique index does not have. Without it a worker that
   * dies mid-run holds `agent_runs_one_active_per_mission_key` forever and that
   * mission can never be taught again — the one thing a real queue would have
   * given for free, which is why §10's note about the missing queue names this.
   */
  async reapStale(limit = 20): Promise<readonly AgentRun[]> {
    const now = this.clock.now();
    // The cutoff, not the clock. Passing `now` would match every running run —
    // a heartbeat is always in the past — and the reaper would then rely entirely
    // on `isStale` to reject them, doing the work of the WHERE clause in
    // TypeScript over every active run in the system.
    const cutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);
    const stale = await this.runs.findStale(cutoff, limit);
    const reaped: AgentRun[] = [];

    for (const run of stale) {
      // Re-checked against the clock rather than trusted from the query, so the
      // rule lives in the domain and a wrong interval in SQL cannot silently
      // widen it.
      if (!isStale(run, now)) continue;

      const failed = await this.runs.finish(run.userId, run.id, now, {
        status: "failed",
        result: null,
        error: "The worker stopped reporting. The run was ended so the mission is not stuck.",
      });
      if (failed) reaped.push(failed);
    }

    return reaped;
  }

  private async ensureWorkspaceKey(
    userId: string,
    mission: { missionId: string; topic: string; workspaceKey: string | null },
  ): Promise<string> {
    if (mission.workspaceKey !== null) return mission.workspaceKey;

    const taken = await this.missions.takenKeys(userId);
    const derived = deriveWorkspaceKey(mission.topic, taken);
    if (derived === null) throw new WorkspaceKeyUnavailable(mission.missionId);

    // Conditional, so two first-runs racing cannot each assign a different key
    // and split the learner's history across two prefixes. The loser reads back
    // the winner's.
    return this.missions.claimWorkspaceKey(userId, mission.missionId, derived);
  }
}
