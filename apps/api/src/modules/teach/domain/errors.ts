import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

/**
 * What a teach run refuses to do.
 *
 * Each names a `kind` rather than a status code — `shared/http` turns that into
 * HTTP, so this file has no idea what a 409 is (§2.1).
 */

/**
 * A run is already queued or running for this mission.
 *
 * `conflict` rather than `invalid`: the request is well formed and the mission is
 * really yours — the current state is what says no, and the fix is to wait rather
 * than to correct a field. The SPA branches on the slug to show the run in
 * progress instead of an error, which is the honest answer to "teach me
 * something" when something is already being taught.
 *
 * Raised from Postgres's `23505` on `agent_runs_one_active_per_mission_key`
 * rather than from a check-then-insert, because two dispatcher ticks racing is
 * exactly the case a check cannot cover — and left to the driver it arrives as an
 * opaque error and becomes a 500.
 */
export class RunAlreadyActive extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "run-already-active";
  readonly detailKey: ServerMessageKey = "error.teach.run_already_active";

  constructor(missionId: string) {
    super(`A run is already active for mission ${missionId}`);
  }
}

/**
 * The run id is not one of yours.
 *
 * `not_found` rather than `forbidden`, for the reason `MissionNotFound` gives:
 * RLS makes "not yours" and "does not exist" the same observation, and
 * distinguishing them would confirm that some other user owns this id.
 */
export class AgentRunNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "agent-run-not-found";
  readonly detailKey: ServerMessageKey = "error.teach.run_not_found";

  constructor(id: string) {
    super(`Agent run ${id} not found`);
  }
}

/**
 * A status move nothing should have attempted.
 *
 * Almost always a late message from a worker whose run was already reaped or
 * cancelled — so it is `conflict` rather than `invalid`: the caller is not
 * malformed, it is out of date. Surfacing it rather than swallowing it is the
 * point, because silently accepting the move is how a reaped run comes back to
 * life and starts writing to a workspace another run now owns.
 */
export class RunTransitionInvalid extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "run-transition-invalid";
  readonly detailKey: ServerMessageKey = "error.teach.run_transition_invalid";

  constructor(from: string, to: string) {
    super(`Cannot move a run from ${from} to ${to}`);
  }
}

/**
 * The mission has never been materialised and cannot be.
 *
 * `workspace_key` is set once at first materialisation and a mission whose topic
 * cannot produce one has nothing to name a Storage prefix with. Reachable with a
 * topic that is entirely punctuation or a script `slugify` strips to nothing —
 * unlikely, and the alternative is a prefix of `workspaces/<uid>/`, which is
 * every other unnamed mission's prefix too.
 */
export class WorkspaceKeyUnavailable extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "workspace-key-unavailable";
  readonly detailKey: ServerMessageKey = "error.teach.workspace_key_unavailable";

  constructor(missionId: string) {
    super(`Cannot derive a workspace key for mission ${missionId}`);
  }
}

/**
 * Today's teaching budget is spent (FR-T8).
 *
 * `conflict` rather than `forbidden`: nothing about the request or the caller is
 * wrong, and they will be allowed to make exactly this request again at midnight.
 * `forbidden` reads as "not for you", which would be false and would send someone
 * looking at their account rather than at the clock.
 *
 * **The cap travels with the error.** A message that says only "limit reached" is
 * the version that gets pressed eleven more times, so `detailVars` carries the
 * figure and the copy names it. The SPA branches on the slug to render the meter
 * instead of a bare error — the same pattern `run-already-active` uses.
 */
export class DailyBudgetExhausted extends DomainError {
  readonly kind: DomainErrorKind = "conflict";
  readonly slug = "teach-daily-budget-exhausted";
  readonly detailKey: ServerMessageKey = "error.teach.daily_budget_exhausted";
  override readonly detailVars: Readonly<Record<string, string>>;

  constructor(spentUsd: number, capUsd: number) {
    super(`Daily teaching budget of $${capUsd} reached; $${spentUsd} spent`);
    // Formatted here rather than in the catalogue because ICU's `number` skeleton
    // would render the currency in the *message's* locale, and the bill is in USD
    // whatever language the learner reads.
    this.detailVars = { cap: `$${capUsd.toFixed(2)}` };
  }
}
