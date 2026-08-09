import type { ResourceType, TrustLevel } from "@mindforge/workspace";

export const WORKSPACE_RESOURCE_WRITER = Symbol("WorkspaceResourceWriter");

/**
 * The four fields `RESOURCES.md` actually represents, and nothing else.
 *
 * The interface is the guardrail. `status`, `progress`, `finished_at` and
 * `abandon_reason` are not expressible here, so no amount of carelessness in the
 * caller can reset a book the learner marked `finished` — which is what a naive
 * write would do on every single run, because the file has no status column and
 * the column defaults to `inbox`.
 */
export interface WorkspaceResourceFields {
  readonly title: string;
  readonly url: string | null;
  readonly type: ResourceType;
  /** Null when the agent's value was unreadable. Never guessed — it grounds the teaching. */
  readonly trust: TrustLevel | null;
}

export interface WorkspaceRejection {
  readonly title: string;
  readonly url: string | null;
  readonly reason: string | null;
}

/** Normalised key → resource id, for the upsert. */
export interface ExistingResourceKeys {
  readonly byUrl: ReadonlyMap<string, string>;
  readonly byTitle: ReadonlyMap<string, string>;
}

export interface WorkspaceResourceWriter {
  /**
   * Every resource this user has, keyed for matching.
   *
   * One read rather than a lookup per row: a `RESOURCES.md` with thirty entries
   * would otherwise be thirty round trips inside a run that is already minutes
   * long, and the whole library is a few hundred rows at the very most.
   */
  existingKeys(userId: string): Promise<ExistingResourceKeys>;

  createFromWorkspace(
    userId: string,
    missionId: string,
    fields: WorkspaceResourceFields,
  ): Promise<void>;

  /**
   * Update the four fields, and link the resource to this mission.
   *
   * The link matters on update as much as on create: a learner who already has
   * The Rust Book from a Rust mission, whose Postgres mission then finds it too,
   * should see it in both libraries. Without it the resource stays attached to
   * whichever mission happened to find it first, and FR-T8's "sources the agent
   * finds appear in your library" quietly means "in one of your libraries".
   */
  updateFromWorkspace(
    userId: string,
    missionId: string,
    resourceId: string,
    fields: WorkspaceResourceFields,
  ): Promise<void>;

  /**
   * Record the agent's judgement on something nobody started.
   *
   * Writes `rejected_reason`. **Never `abandon_reason`** — that is the learner's
   * own guilt-free quit (FR-R5), and conflating them would invent an abandonment
   * that never happened and corrupt the friction data it feeds.
   */
  rejectExisting(
    userId: string,
    missionId: string,
    resourceId: string,
    reason: string | null,
  ): Promise<void>;

  createRejected(userId: string, missionId: string, rejection: WorkspaceRejection): Promise<void>;
}
