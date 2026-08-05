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
    readonly skillId: string | null,
    readonly resourceId: string | null,
    readonly taskId: string | null,
  ) {
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
      throw new RangeError(`intensity must be an integer from 1 to 5, received ${intensity}`);
    }
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
