export const TEACH_DISPATCH_GATEWAY = Symbol("TeachDispatchGateway");

import type { BriefingKind } from "@mindforge/workspace";

export interface QueuedRun {
  readonly id: string;
  readonly userId: string;
  readonly missionId: string;
  /**
   * Which agent to load. Decided by the API from whether the mission has modules
   * (FR-K1), never here — the dispatcher's job is to run what was queued.
   */
  readonly kind: BriefingKind;
  /** Assigned by the API when the run was queued, so the worker never derives one. */
  readonly workspaceKey: string;
  /**
   * The learner's IANA zone.
   *
   * Carried rather than looked up later because every "day" in this product
   * derives from it (§5.2), and a learning record dated 2026-08-08 that resolves
   * server-local can land on the 7th — in a different weekly review.
   */
  readonly timezone: string;
}

export interface TeachDispatchGateway {
  /**
   * The next queued run to serve, across every user.
   *
   * The one cross-user read the dispatcher makes, and it is correct for the same
   * reason `NightlyGateway.listProfiles` is: nobody is signed in, and everything
   * afterwards is scoped by the `userId` this returns.
   *
   * **Round-robin between learners, oldest-first within one.** Plain oldest-first
   * is fair between runs and unfair between people: the worker runs one agent at a
   * time and a run takes minutes, so a learner with six queued missions would hold
   * it for the best part of an hour. Whoever was served longest ago goes next, and
   * a learner with no run behind them at all goes first.
   */
  nextQueued(): Promise<QueuedRun | null>;

  /**
   * Compose the run's plugin into a directory.
   *
   * Per run rather than per process: the run's temp tree is deleted afterwards,
   * and a shared path would be shared mutable state for four small files.
   *
   * Exactly one skill, chosen by `kind`. A run that could reach for both would be
   * a teach run able to rewrite the plan it is working through, or a curriculum
   * run able to generate the whole module at the moment it knows least.
   */
  writePlugin(
    runId: string,
    kind: BriefingKind,
  ): Promise<{ readonly path: string; readonly skillRef: string }>;
}
