export const TEACH_DISPATCH_GATEWAY = Symbol("TeachDispatchGateway");

export interface QueuedRun {
  readonly id: string;
  readonly userId: string;
  readonly missionId: string;
  /** Assigned by the API when the run was queued, so the worker never derives one. */
  readonly workspaceKey: string;
}

export interface TeachDispatchGateway {
  /**
   * The oldest queued run, across every user.
   *
   * The one cross-user read the dispatcher makes, and it is correct for the same
   * reason `NightlyGateway.listProfiles` is: nobody is signed in, and everything
   * afterwards is scoped by the `userId` this returns.
   *
   * Oldest first, so a user who queued while another mission was running is not
   * starved by a user who kept pressing the button.
   */
  nextQueued(): Promise<QueuedRun | null>;

  /**
   * Compose the teach plugin into a directory for this run.
   *
   * Per run rather than per process: the run's temp tree is deleted afterwards,
   * and a shared path would be shared mutable state for four small files.
   */
  writePlugin(runId: string): Promise<{ readonly path: string; readonly skillRef: string }>;
}
