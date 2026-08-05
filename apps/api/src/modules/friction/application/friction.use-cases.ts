import {
  CHIP_WINDOW_DAYS,
  frictionChips,
  frictionSplit,
  type FrictionChips,
  type FrictionSplit,
  type FrictionSummaryQuery,
  type LogFrictionInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { FrictionEvent } from "../domain/friction-event.js";
import {
  FRICTION_EVENT_REPOSITORY,
  type FrictionEventRepository,
} from "../domain/friction-event.repository.js";

/**
 * FR-C1, FR-C2 — one tap, typed, no modal.
 *
 * The most latency-sensitive write in the product: it happens mid-session, one-handed, usually
 * while annoyed. So there is exactly one round trip, no validation that requires another read,
 * and no attempt to look up the running session server-side — the client sends `sessionId`
 * because a queued event must land on the session it happened in, not the one running when it
 * finally uploads.
 *
 * Idempotent on the client-generated id (§6.1). A replayed tap returns the event that already
 * exists, which is what makes the offline queue safe to flush blindly.
 */
@Injectable()
export class LogFriction {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: LogFrictionInput): Promise<FrictionEvent> {
    if (input.id) {
      const existing = await this.events.findById(userId, input.id);
      if (existing) return existing;
    }

    const now = this.clock.now();

    const event = FrictionEvent.log({
      id: input.id ?? this.ids.next(),
      userId,
      type: input.type,
      intensity: input.intensity,
      note: input.note,
      // A queued event carries its own timestamp; a live tap does not need to. Clamped so a
      // client with a fast clock cannot file friction in the future, which would sit at the
      // top of every "recent" list forever.
      occurredAt: input.occurredAt && input.occurredAt <= now ? input.occurredAt : now,
      sessionId: input.sessionId,
      skillId: input.skillId,
      resourceId: input.resourceId,
      taskId: input.taskId,
    });

    await this.events.save(userId, event);
    return event;
  }
}

/**
 * Which four chips to show inline (§5.3).
 *
 * Its own endpoint rather than part of the session payload, because the ranking changes on a
 * 30-day window and the running session changes every few minutes — caching them together
 * would mean refetching one to learn nothing about the other.
 */
@Injectable()
export class GetFrictionChips {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string): Promise<FrictionChips> {
    const since = new Date(this.clock.now().getTime() - CHIP_WINDOW_DAYS * 86_400_000);
    return frictionChips(await this.events.countByType(userId, since));
  }
}

export interface FrictionSummary extends FrictionSplit {
  readonly eventCount: number;
  readonly byType: Partial<Record<string, number>>;
}

/**
 * The ember/slag split (FR-C3).
 *
 * Computed here from a deterministic rule, never read from a stored column — a rule you can
 * read beats a number you have to trust, and this one drives the app's headline metric.
 *
 * `minutes` is 1 per event rather than a real duration, and that is a known simplification
 * worth naming: friction events are moments, not intervals, so the split is currently a *count*
 * share dressed in the minutes field. Weighting by intensity or by the gap between consecutive
 * events would both be inventions. The honest version arrives with the weekly review (M2),
 * which is the first screen that reports it.
 */
@Injectable()
export class GetFrictionSummary {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
  ) {}

  async execute(userId: string, query: FrictionSummaryQuery): Promise<FrictionSummary> {
    const rows = await this.events.listClassifiable(userId, query);

    const byType: Record<string, number> = {};
    for (const row of rows) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
    }

    const split = frictionSplit(
      rows.map((row) => ({
        type: row.type,
        minutes: 1,
        outcome: { producedLearning: row.sessionProducedLearning ?? false },
      })),
    );

    return { ...split, eventCount: rows.length, byType };
  }
}
