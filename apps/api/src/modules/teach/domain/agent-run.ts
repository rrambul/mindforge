/**
 * One invocation of the agent (FR-T3).
 *
 * A record with a state machine rather than a rich entity: the only rule worth
 * protecting is which status may follow which, and that rule exists because two
 * of the transitions are made by *different processes*. The API creates a run;
 * the worker claims, heartbeats and finishes it. A status field with no stated
 * legal moves is how a dead worker's run stays `running` forever and wedges its
 * mission behind the single-active-run index.
 */

export type AgentRunKind =
  | "generate_lesson"
  | "sync_workspace"
  | "generate_assessment"
  | "grade_teach_back"
  | "weekly_digest"
  | "generate_plan";

export type AgentRunStatus =
  | "queued"
  | "running"
  /** Finished, and everything the agent wrote landed. */
  | "succeeded"
  /**
   * Finished, and somebody else had written to at least one file. Both versions
   * were kept (§7.4). **This is a success**: folding it into `failed` would make
   * the honest outcome look like the broken one, and push people toward
   * resolving conflicts by re-running.
   */
  | "succeeded_with_conflicts"
  | "failed"
  | "cancelled";

/** The statuses the partial unique index treats as occupying a mission. */
export const ACTIVE_STATUSES = ["queued", "running"] as const satisfies readonly AgentRunStatus[];

export function isActive(status: AgentRunStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isTerminal(status: AgentRunStatus): boolean {
  return !isActive(status);
}

/**
 * Which moves are legal.
 *
 * Terminal states have no successors at all, which is what makes a late message
 * from a worker that was already reaped a no-op rather than a resurrection.
 */
const TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "succeeded_with_conflicts", "failed", "cancelled"],
  succeeded: [],
  succeeded_with_conflicts: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface AgentRunResult {
  /** Paths touched, by kind, for the run summary. */
  readonly changes?: Readonly<Record<string, readonly string[]>>;
  /** Parser warnings, as stable keys plus ICU args — never rendered prose (§5.2). */
  readonly warnings?: readonly {
    readonly code: string;
    readonly args?: Readonly<Record<string, unknown>>;
  }[];
  /** Contested paths, retained beside their originals. */
  readonly conflicts?: readonly { readonly path: string; readonly reason: string }[];
  /**
   * The SDK's own cost estimate, stored as a cross-check against ours and never
   * as the source of truth — it comes from a price table baked in when the SDK
   * was built, and its docs say not to bill from it (§8.6).
   */
  readonly sdkCostUsd?: number;
  readonly turns?: number;
  readonly durationMs?: number;
}

export interface AgentRun {
  readonly id: string;
  readonly userId: string;
  readonly missionId: string | null;
  readonly kind: AgentRunKind;
  readonly status: AgentRunStatus;
  readonly input: Readonly<Record<string, unknown>> | null;
  readonly result: AgentRunResult | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly heartbeatAt: Date | null;
  readonly finishedAt: Date | null;
}

/**
 * How long a `running` run may go silent before the reaper fails it.
 *
 * Comfortably longer than the gap between messages in a real run — the agent
 * heartbeats on every message and a single model turn is seconds, not minutes —
 * and comfortably shorter than the 15-minute hard timeout, so a crashed worker
 * does not hold its mission for the whole window. Without a reaper the partial
 * unique index has no release: a worker that dies mid-run wedges that mission
 * forever, which is the one thing a real queue would have given for free.
 */
export const HEARTBEAT_TIMEOUT_MS = 3 * 60_000;

export function isStale(run: AgentRun, now: Date, timeoutMs = HEARTBEAT_TIMEOUT_MS): boolean {
  if (run.status !== "running") return false;
  // A run that claimed but has not yet reported a message is measured from when
  // it started, not treated as fresh forever.
  const last = run.heartbeatAt ?? run.startedAt;
  return last === null || now.getTime() - last.getTime() > timeoutMs;
}
