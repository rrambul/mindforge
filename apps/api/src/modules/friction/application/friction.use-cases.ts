import {
  CHIP_WINDOW_DAYS,
  frictionChips,
  frictionSplit,
  type AttributeFrictionInput,
  type FrictionChips,
  type FrictionMoment,
  type FrictionSplit,
  type FrictionSummaryQuery,
  type LogFrictionInput,
  type SessionFriction,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { AttributionTargetMissing, FrictionEventNotFound } from "../domain/errors.js";
import { FrictionEvent } from "../domain/friction-event.js";
import {
  FRICTION_EVENT_REPOSITORY,
  type FrictionEventRepository,
} from "../domain/friction-event.repository.js";
import { ATTRIBUTION_TARGETS, type AttributionTargetReader } from "./attribution-targets.port.js";

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
  /**
   * Events that got no minutes — logged outside a session, or inside one still running.
   *
   * Reported rather than dropped. They are counted in `eventCount` and in `byType`, so "tooling is
   * your top source" still includes them, but they cannot be in `emberMinutes` or `slagMinutes`
   * because there is no duration to divide. A summary that silently omitted them would make the
   * two numbers disagree with the count above them for no visible reason.
   */
  readonly unattributedEventCount: number;
}

/**
 * `SessionFriction` is readonly all the way down, which is right for a value crossing into
 * packages/core and wrong for the accumulator that builds one. This is the same shape with the
 * array open, so the grouping loop can push without a cast.
 */
interface MutableSessionFriction extends Omit<SessionFriction, "events"> {
  readonly events: FrictionMoment[];
}

/**
 * The ember/slag split (FR-C3).
 *
 * Computed here from a deterministic rule, never read from a stored column — a rule you can
 * read beats a number you have to trust, and this one drives the app's headline metric.
 *
 * Until M2 the `minutes` fed to `frictionSplit` was 1 per event, so the "share of minutes" was a
 * share of the *count* wearing the minutes field. It is now real: a session's own length divided
 * among its events in proportion to intensity, which is why the rows are grouped by session here
 * before the split sees them. The rule and the reasoning live in `packages/core/src/friction/split.ts`.
 */
@Injectable()
export class GetFrictionSummary {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
  ) {}

  async execute(userId: string, query: FrictionSummaryQuery): Promise<FrictionSummary> {
    const rows = await this.events.listClassifiable(userId, query);

    const byType: Record<string, number> = {};
    const bySession = new Map<string, MutableSessionFriction>();
    let unattributedEventCount = 0;

    for (const row of rows) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;

      if (row.sessionId === null || row.sessionMinutes === null) {
        unattributedEventCount += 1;
        continue;
      }

      let session = bySession.get(row.sessionId);
      if (session === undefined) {
        session = {
          minutes: row.sessionMinutes,
          outcome: { producedLearning: row.sessionProducedLearning ?? false },
          events: [],
        };
        bySession.set(row.sessionId, session);
      }
      session.events.push({ type: row.type, intensity: row.intensity });
    }

    const split = frictionSplit(bySession.values());

    return { ...split, eventCount: rows.length, byType, unattributedEventCount };
  }
}

/**
 * What the friction was about (§5.3).
 *
 * `friction_events.skill_id` and `resource_id` have existed since M0 and nothing ever wrote them, so
 * every event was typed but unattributed — which makes "your top friction source is tooling" the most
 * specific thing M2's review screen could have said. Attribution is what turns that into "tooling, on
 * the Rust mission, while reading the async book".
 *
 * Set from the debrief rather than the chip tap, deliberately. The chip is a one-tap capture and asking
 * "which skill?" mid-annoyance would break the budget the whole feature is built around; §5.3 puts the
 * detail in the debrief, "where you have the time".
 */
@Injectable()
export class AttributeFriction {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
    @Inject(ATTRIBUTION_TARGETS) private readonly targets: AttributionTargetReader,
  ) {}

  async execute(userId: string, id: string, input: AttributeFrictionInput): Promise<FrictionEvent> {
    const event = await this.events.findById(userId, id);
    if (!event) throw new FrictionEventNotFound(id);

    // Verified before the write, so a bad id cannot leave one half of the attribution applied. Only a
    // *named* target is checked: null is a retraction, and there is nothing to look up.
    if (input.skillId != null && !(await this.targets.exists(userId, "skill", input.skillId))) {
      throw new AttributionTargetMissing("skill", input.skillId);
    }
    if (
      input.resourceId != null &&
      !(await this.targets.exists(userId, "resource", input.resourceId))
    ) {
      throw new AttributionTargetMissing("resource", input.resourceId);
    }

    event.attributeTo({
      ...(input.skillId === undefined ? {} : { skillId: input.skillId }),
      ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId }),
    });

    await this.events.save(userId, event);
    return event;
  }
}

/** A session's own friction, for the debrief. */
@Injectable()
export class ListSessionFriction {
  constructor(
    @Inject(FRICTION_EVENT_REPOSITORY) private readonly events: FrictionEventRepository,
  ) {}

  execute(userId: string, sessionId: string): Promise<FrictionEvent[]> {
    return this.events.listForSession(userId, sessionId);
  }
}
