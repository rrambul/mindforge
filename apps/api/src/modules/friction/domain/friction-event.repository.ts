import type { FrictionType } from "@mindforge/core";
import type { FrictionEvent } from "./friction-event.js";

export const FRICTION_EVENT_REPOSITORY = Symbol("FrictionEventRepository");

export interface FrictionFilter {
  readonly since?: Date | undefined;
  /** Exclusive, so two adjacent weeks cannot both claim an event on the boundary. */
  readonly until?: Date | undefined;
  readonly missionId?: string | undefined;
}

/** One row per event, joined to its session so friction can be classified and attributed. */
export interface ClassifiableFrictionEvent {
  readonly type: FrictionType;
  readonly intensity: number;
  readonly occurredAt: Date;
  /** Null for a standalone tap — one logged outside any session. */
  readonly sessionId: string | null;
  /**
   * The session's own length. Null when there was no session, or when it is still running.
   *
   * This is what the ember/slag split divides among a session's events (§9.3 as settled in M2):
   * friction events are moments, so the minutes are the session's, attributed by intensity.
   */
  readonly sessionMinutes: number | null;
  /**
   * Null when the event was logged outside a session, or the session has no debrief yet.
   * `classifyFriction` treats absent as "did not produce learning", which is the honest
   * reading — see `producedLearning` in packages/core.
   */
  readonly sessionProducedLearning: boolean | null;
}

export interface FrictionEventRepository {
  findById(userId: string, id: string): Promise<FrictionEvent | null>;

  /** Idempotent on the client-generated id, so a replayed tap is not a second event (§6.1). */
  save(userId: string, event: FrictionEvent): Promise<void>;

  /**
   * Counts per type over a window, for the chip ranking (§5.3).
   *
   * Aggregated in Postgres rather than by loading events and counting in TypeScript: this runs
   * on every render of the capture bar, and the answer is eleven integers.
   */
  countByType(userId: string, since: Date): Promise<Partial<Record<FrictionType, number>>>;

  /** The rows the ember/slag split is computed from. */
  listClassifiable(userId: string, filter: FrictionFilter): Promise<ClassifiableFrictionEvent[]>;

  /**
   * A session's own events, oldest first.
   *
   * For the debrief, which is where §5.3 puts friction detail. Oldest first because you are recalling
   * the block in the order it happened, not in the order a database felt like returning it.
   */
  listForSession(userId: string, sessionId: string): Promise<FrictionEvent[]>;
}
