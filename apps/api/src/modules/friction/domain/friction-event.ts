import { DEFAULT_FRICTION_INTENSITY, type FrictionType } from "@mindforge/core";

export interface FrictionEventSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly type: FrictionType;
  readonly intensity: number;
  readonly note: string | null;
  readonly occurredAt: Date;
  readonly sessionId: string | null;
  readonly skillId: string | null;
  readonly resourceId: string | null;
  readonly taskId: string | null;
}

/**
 * One moment of friction.
 *
 * Almost nothing to enforce, and that is deliberate rather than an oversight: this is the
 * cheapest write in the product, and every rule added here is a way for a one-tap capture to
 * fail. The type is closed (eleven values, so the ratio stays computable) and the intensity is
 * bounded. Everything else is optional.
 *
 * What is *not* stored is the more important design decision: whether an event is productive
 * or wasteful is computed from type plus session outcome by `classifyFriction`, never
 * persisted. Storing it would let the two drift, and the drift would be invisible — the number
 * would still look like a number.
 */
export class FrictionEvent {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly type: FrictionType,
    readonly intensity: number,
    readonly note: string | null,
    readonly occurredAt: Date,
    readonly sessionId: string | null,
    /**
     * What the friction was *about*, set later rather than at capture.
     *
     * Private with getters, unlike the fields above, because these two are the only ones a person
     * revises: §5.3 puts friction detail in the session debrief, "where you have the time", precisely
     * so the chip tap stays one tap. Asking mid-session which skill it was would break the budget the
     * whole feature is built around.
     */
    private skillIdValue: string | null,
    private resourceIdValue: string | null,
    readonly taskId: string | null,
  ) {
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
      throw new RangeError(`intensity must be an integer from 1 to 5, received ${intensity}`);
    }
  }

  get skillId(): string | null {
    return this.skillIdValue;
  }

  get resourceId(): string | null {
    return this.resourceIdValue;
  }

  /**
   * Attributes the friction to a skill, a resource, both, or neither (§5.3).
   *
   * Both are replaced rather than merged, so clearing one is expressible — "actually this was not about
   * that skill" has to be sayable, and a merge would make an attribution permanent once made.
   *
   * Nothing else about the event can be revised. The type and the moment are what you tapped; changing
   * them afterwards would make the friction record a story rather than a log.
   */
  attributeTo(attribution: { skillId?: string | null; resourceId?: string | null }): void {
    if (attribution.skillId !== undefined) this.skillIdValue = attribution.skillId;
    if (attribution.resourceId !== undefined) this.resourceIdValue = attribution.resourceId;
  }

  static log(input: {
    id: string;
    userId: string;
    type: FrictionType;
    intensity?: number | undefined;
    note?: string | null | undefined;
    occurredAt: Date;
    sessionId?: string | null | undefined;
    skillId?: string | null | undefined;
    resourceId?: string | null | undefined;
    taskId?: string | null | undefined;
  }): FrictionEvent {
    return new FrictionEvent(
      input.id,
      input.userId,
      input.type,
      input.intensity ?? DEFAULT_FRICTION_INTENSITY,
      input.note ?? null,
      input.occurredAt,
      input.sessionId ?? null,
      input.skillId ?? null,
      input.resourceId ?? null,
      input.taskId ?? null,
    );
  }

  static fromSnapshot(snapshot: FrictionEventSnapshot): FrictionEvent {
    return new FrictionEvent(
      snapshot.id,
      snapshot.userId,
      snapshot.type,
      snapshot.intensity,
      snapshot.note,
      snapshot.occurredAt,
      snapshot.sessionId,
      snapshot.skillId,
      snapshot.resourceId,
      snapshot.taskId,
    );
  }

  toSnapshot(): FrictionEventSnapshot {
    return {
      id: this.id,
      userId: this.userId,
      type: this.type,
      intensity: this.intensity,
      note: this.note,
      occurredAt: this.occurredAt,
      sessionId: this.sessionId,
      skillId: this.skillId,
      resourceId: this.resourceId,
      taskId: this.taskId,
    };
  }
}
