import type {
  CreateFocusSessionInput,
  DebriefFocusSessionInput,
  StartFocusSessionInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ID_GENERATOR, type IdGenerator } from "../../../shared/ids/id-generator.js";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { FocusSessionAlreadyRunning, FocusSessionNotFound } from "../domain/errors.js";
import { FocusSession } from "../domain/focus-session.js";
import {
  FOCUS_SESSION_REPOSITORY,
  type FocusSessionRepository,
} from "../domain/focus-session.repository.js";

/**
 * FR-F3, and the tightest capture path in the product: one field, one tap.
 *
 * Idempotent on a client-supplied id (§6.1). A replayed start returns the session that
 * already exists rather than refusing — the offline queue has no way to know whether its
 * first attempt landed, so "already there" has to be a success, not a conflict. Without
 * that, a flaky connection turns one start into an error the user has to interpret.
 */
@Injectable()
export class StartFocusSession {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(userId: string, input: StartFocusSessionInput): Promise<FocusSession> {
    if (input.id) {
      const existing = await this.sessions.findById(userId, input.id);
      if (existing) return existing;
    }

    // Two concurrent sessions has no meaning — a session is a bounded block of attention.
    // Refused rather than auto-stopping the other, so a block never ends without the chance
    // to debrief it; the slug lets the SPA offer "stop that one and start this" as one tap.
    const running = await this.sessions.findRunning(userId);
    if (running) throw new FocusSessionAlreadyRunning(running.id);

    const session = FocusSession.start({
      id: input.id ?? this.ids.next(),
      userId,
      intention: input.intention ?? null,
      plannedMinutes: input.plannedMinutes ?? null,
      attachments: {
        missionId: input.missionId ?? null,
      },
      now: this.clock.now(),
    });

    await this.sessions.save(userId, session);
    return session;
  }
}

/**
 * Stopping takes no arguments, and that is the design (§5.3): the debrief is a separate
 * call, so ending a block costs one tap even when you have nothing to say about it.
 *
 * Idempotent for the same reason as start — a replayed stop returns the already-stopped
 * session instead of a 409, because the queue cannot know its first attempt arrived.
 */
@Injectable()
export class StopFocusSession {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<FocusSession> {
    const session = await this.sessions.findById(userId, id);
    if (!session) throw new FocusSessionNotFound(id);

    if (!session.isRunning) return session;

    session.stop(this.clock.now());
    await this.sessions.save(userId, session);
    return session;
  }
}

@Injectable()
export class DebriefFocusSession {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
  ) {}

  async execute(
    userId: string,
    id: string,
    input: DebriefFocusSessionInput,
  ): Promise<FocusSession> {
    const session = await this.sessions.findById(userId, id);
    if (!session) throw new FocusSessionNotFound(id);

    // Merges, so answering the outcome now and the ratings a minute later does not erase
    // the first answer. Throws if the session is still running — the entity owns that rule.
    session.writeDebrief({
      ...(input.hitIntention === undefined ? {} : { hitIntention: input.hitIntention }),
      ...(input.focusQuality === undefined ? {} : { focusQuality: input.focusQuality }),
      ...(input.energy === undefined ? {} : { energy: input.energy }),
      ...(input.note === undefined ? {} : { note: input.note }),
    });

    await this.sessions.save(userId, session);
    return session;
  }
}

/**
 * FR-F2 — manual and retroactive entry. You *will* forget the timer, and if backfilling is
 * painful the data dies within two weeks.
 *
 * Notably does **not** check for a running session: a block you are entering after the fact
 * is unrelated to whatever is running now, and refusing it would mean stopping your current
 * session to record a forgotten one.
 */
@Injectable()
export class RecordFocusSession {
  constructor(
    @Inject(FOCUS_SESSION_REPOSITORY) private readonly sessions: FocusSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /**
   * `timeZone` is threaded in rather than read, because `entryMode` is a claim about *your* day.
   *
   * It used to be decided by comparing UTC dates, so a São Paulo user recording at 21:30 an entry
   * for work finished at 20:00 the same evening got `backfilled` — it was already 00:30 UTC. Only
   * the controller has the profile's timezone (`RequestContext`), and the domain takes it as an
   * argument for the same reason it takes `now`.
   */
  async execute(
    userId: string,
    input: CreateFocusSessionInput,
    timeZone: string,
  ): Promise<FocusSession> {
    if (input.id) {
      const existing = await this.sessions.findById(userId, input.id);
      if (existing) return existing;
    }

    const session = FocusSession.record({
      id: input.id ?? this.ids.next(),
      userId,
      intention: input.intention ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      debrief: {
        hitIntention: input.hitIntention ?? null,
        focusQuality: input.focusQuality ?? null,
        energy: input.energy ?? null,
        note: input.note ?? null,
      },
      attachments: {
        missionId: input.missionId ?? null,
      },
      now: this.clock.now(),
      timeZone,
    });

    await this.sessions.save(userId, session);
    return session;
  }
}
