import type { AgentRun, AgentRunKind, AgentRunResult, AgentRunStatus } from "./agent-run.js";

export const AGENT_RUN_REPOSITORY = Symbol("AgentRunRepository");

export interface CreateAgentRun {
  readonly id: string;
  readonly missionId: string | null;
  readonly kind: AgentRunKind;
  readonly input: Readonly<Record<string, unknown>> | null;
}

export interface FinishAgentRun {
  readonly status: Extract<
    AgentRunStatus,
    "succeeded" | "succeeded_with_conflicts" | "failed" | "cancelled"
  >;
  readonly result: AgentRunResult | null;
  readonly error: string | null;
}

export interface AgentRunRepository {
  /**
   * Insert a `queued` run, or refuse because one is already active.
   *
   * Returns `null` on the unique-index violation rather than throwing, so the
   * caller can raise `RunAlreadyActive` with the mission id it already has. The
   * enforcement is Postgres's `agent_runs_one_active_per_mission_key` — a
   * check-then-insert cannot cover two dispatcher ticks racing, which is exactly
   * the case that matters.
   */
  create(userId: string, run: CreateAgentRun): Promise<AgentRun | null>;

  find(userId: string, id: string): Promise<AgentRun | null>;

  /** Newest first, capped by the caller. */
  listForMission(userId: string, missionId: string, limit: number): Promise<AgentRun[]>;

  /**
   * Compare-and-swap `queued` → `running`.
   *
   * Returns `null` when the row was not still `queued`, which is how two
   * dispatchers cannot both claim one run. A read-then-write would let both see
   * `queued` and both proceed, and two agents on one workspace is the corruption
   * the single-active-run index exists to prevent.
   */
  claim(userId: string, id: string, at: Date): Promise<AgentRun | null>;

  /**
   * Bump `heartbeat_at`, if the run is still running.
   *
   * Returns whether it landed. A `false` means the run was reaped or cancelled
   * underneath the worker, which is a signal to abort rather than something to
   * ignore — the mission may already have been claimed by a newer run.
   */
  heartbeat(userId: string, id: string, at: Date): Promise<boolean>;

  /** Move to a terminal status. Refuses a move the state machine forbids. */
  finish(userId: string, id: string, at: Date, outcome: FinishAgentRun): Promise<AgentRun | null>;

  /**
   * Every `running` run whose heartbeat has gone stale, across all users.
   *
   * The one cross-user read in this interface, and it is why the reaper runs in
   * the worker rather than behind a request: nobody is signed in when a worker
   * dies. Every write it drives afterwards is scoped by the `userId` it got from
   * here — the same shape as `NightlyGateway.listProfiles`.
   */
  findStale(before: Date, limit: number): Promise<AgentRun[]>;
}
