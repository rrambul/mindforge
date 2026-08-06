import { COLD_START_CHIPS, PINNED_FRICTION_TYPE, type FrictionType } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import { AttributionTargetMissing, FrictionEventNotFound } from "../domain/errors.js";
import type { FrictionEvent } from "../domain/friction-event.js";
import type {
  ClassifiableFrictionEvent,
  FrictionEventRepository,
  FrictionFilter,
} from "../domain/friction-event.repository.js";
import type { AttributionTargetReader } from "./attribution-targets.port.js";
import {
  AttributeFriction,
  GetFrictionChips,
  GetFrictionSummary,
  ListSessionFriction,
  LogFriction,
} from "./friction.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T12:00:00Z");

/** Everything exists unless a test says otherwise. */
class StubAttributionTargets implements AttributionTargetReader {
  readonly missing = new Set<string>();

  exists(_userId: string, _kind: "skill" | "resource", id: string): Promise<boolean> {
    return Promise.resolve(!this.missing.has(id));
  }
}

class InMemoryFriction implements FrictionEventRepository {
  private readonly byUser = new Map<string, Map<string, FrictionEvent>>();
  /** Set directly by tests that care about the split rather than about logging. */
  classifiable: ClassifiableFrictionEvent[] = [];
  saveCount = 0;

  private own(userId: string): Map<string, FrictionEvent> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, FrictionEvent>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<FrictionEvent | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  save(userId: string, event: FrictionEvent): Promise<void> {
    this.saveCount += 1;
    this.own(userId).set(event.id, event);
    return Promise.resolve();
  }

  countByType(userId: string, since: Date): Promise<Partial<Record<FrictionType, number>>> {
    const counts: Partial<Record<FrictionType, number>> = {};
    for (const event of this.own(userId).values()) {
      if (event.occurredAt < since) continue;
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    }
    return Promise.resolve(counts);
  }

  // Both parameters are ignored on purpose: the filtering they drive is Postgres' job and is
  // covered by the integration suite. These tests are about the classification rule.
  listForSession(userId: string, sessionId: string): Promise<FrictionEvent[]> {
    return Promise.resolve(
      [...this.own(userId).values()]
        .filter((event) => event.sessionId === sessionId)
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
    );
  }

  listClassifiable(userId: string, filter: FrictionFilter): Promise<ClassifiableFrictionEvent[]> {
    void userId;
    void filter;
    return Promise.resolve(this.classifiable);
  }
}

describe("LogFriction", () => {
  let events: InMemoryFriction;
  let log: LogFriction;

  beforeEach(() => {
    events = new InMemoryFriction();
    log = new LogFriction(events, new FixedClock(NOW), new SequentialIdGenerator());
  });

  it("logs from a type alone", async () => {
    // One tap. This is the ≤5s budget: nothing else is required and nothing else is asked.
    const event = await log.execute(ALICE, { type: "tooling", intensity: 3 });

    expect(event.type).toBe("tooling");
    expect(event.intensity).toBe(3);
    expect(event.occurredAt).toEqual(NOW);
    expect(event.sessionId).toBeNull();
  });

  it("attaches to the session the client names", async () => {
    // The client sends it, not the server: a queued event must land on the session it happened
    // in, not the one running when it finally uploads.
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const event = await log.execute(ALICE, { type: "interruption", intensity: 3, sessionId });
    expect(event.sessionId).toBe(sessionId);
  });

  it("keeps a queued event's own timestamp", async () => {
    const occurredAt = new Date("2026-08-05T10:15:00Z");
    const event = await log.execute(ALICE, { type: "tooling", intensity: 3, occurredAt });
    expect(event.occurredAt).toEqual(occurredAt);
  });

  it("clamps a timestamp from the future to now", async () => {
    // A client with a fast clock would otherwise file friction that sits at the top of every
    // "recent" list forever.
    const event = await log.execute(ALICE, {
      type: "tooling",
      intensity: 3,
      occurredAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(event.occurredAt).toEqual(NOW);
  });

  it("is idempotent on a replayed id, so the queue can flush blindly", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const first = await log.execute(ALICE, { id, type: "tooling", intensity: 3 });
    const replay = await log.execute(ALICE, { id, type: "physical", intensity: 5 });

    expect(replay.id).toBe(first.id);
    // The replay does not rewrite what was logged.
    expect(replay.type).toBe("tooling");
    expect(events.saveCount).toBe(1);
  });

  it("does not let one user's id collide with another's", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    await log.execute(ALICE, { id, type: "tooling", intensity: 3 });
    await expect(log.execute(BOB, { id, type: "physical", intensity: 2 })).resolves.toMatchObject({
      type: "physical",
    });
  });
});

describe("GetFrictionChips", () => {
  let events: InMemoryFriction;
  let clock: FixedClock;
  let chips: GetFrictionChips;

  beforeEach(() => {
    events = new InMemoryFriction();
    clock = new FixedClock(NOW);
    chips = new GetFrictionChips(events, clock);
  });

  it("uses the documented cold start before there is any history", async () => {
    await expect(chips.execute(ALICE)).resolves.toMatchObject({ inline: COLD_START_CHIPS });
  });

  it("promotes what you actually log, keeping the pinned type", async () => {
    const log = new LogFriction(events, clock, new SequentialIdGenerator());
    for (let i = 0; i < 5; i += 1) await log.execute(ALICE, { type: "physical", intensity: 3 });
    for (let i = 0; i < 3; i += 1) await log.execute(ALICE, { type: "avoidance", intensity: 3 });

    const result = await chips.execute(ALICE);
    expect(result.inline[0]).toBe("physical");
    expect(result.inline[1]).toBe("avoidance");
    expect(result.inline.at(-1)).toBe(PINNED_FRICTION_TYPE);
  });

  it("ignores events older than the window", async () => {
    // A lifetime ranking would freeze whatever you struggled with in your first fortnight.
    const log = new LogFriction(events, clock, new SequentialIdGenerator());
    for (let i = 0; i < 9; i += 1) {
      await log.execute(ALICE, {
        type: "physical",
        intensity: 3,
        occurredAt: new Date("2026-05-01T12:00:00Z"),
      });
    }

    await expect(chips.execute(ALICE)).resolves.toMatchObject({ inline: COLD_START_CHIPS });
  });

  it("ranks per user", async () => {
    const log = new LogFriction(events, clock, new SequentialIdGenerator());
    for (let i = 0; i < 9; i += 1) await log.execute(BOB, { type: "physical", intensity: 3 });
    await expect(chips.execute(ALICE)).resolves.toMatchObject({ inline: COLD_START_CHIPS });
  });
});

describe("GetFrictionSummary", () => {
  let events: InMemoryFriction;
  let summary: GetFrictionSummary;

  beforeEach(() => {
    events = new InMemoryFriction();
    summary = new GetFrictionSummary(events);
  });

  function event(
    type: FrictionType,
    sessionProducedLearning: boolean | null,
  ): ClassifiableFrictionEvent {
    return { type, intensity: 3, occurredAt: NOW, sessionProducedLearning };
  }

  it("reports no ember share when there is nothing to report", async () => {
    // Null, not zero. "No friction logged" and "all of it was wasteful" are different claims,
    // and showing 0% for the first would be a lie the user could act on.
    await expect(summary.execute(ALICE, {})).resolves.toMatchObject({
      emberShare: null,
      eventCount: 0,
    });
  });

  it("counts productive struggle as ember regardless of outcome", async () => {
    events.classifiable = [event("productive_struggle", false)];
    await expect(summary.execute(ALICE, {})).resolves.toMatchObject({ emberShare: 1 });
  });

  it("counts tooling as slag regardless of outcome", async () => {
    // Deliberately not moralising: a good session does not make a broken build tool productive.
    events.classifiable = [event("tooling", true)];
    await expect(summary.execute(ALICE, {})).resolves.toMatchObject({ emberShare: 0 });
  });

  it("splits `too hard` on whether the block arrived somewhere", async () => {
    // The same event type with opposite meanings: desirable difficulty versus a ZPD miss.
    events.classifiable = [event("too_hard", true), event("too_hard", false)];
    await expect(summary.execute(ALICE, {})).resolves.toMatchObject({ emberShare: 0.5 });
  });

  it("treats an undebriefed session as having produced nothing", async () => {
    // Otherwise the ember share drifts upward when you stop filling the debrief in.
    events.classifiable = [event("too_hard", null)];
    await expect(summary.execute(ALICE, {})).resolves.toMatchObject({ emberShare: 0 });
  });

  it("counts by type, for the top-sources list", async () => {
    events.classifiable = [
      event("tooling", false),
      event("tooling", false),
      event("interruption", false),
    ];
    const result = await summary.execute(ALICE, {});
    expect(result.byType).toEqual({ tooling: 2, interruption: 1 });
    expect(result.eventCount).toBe(3);
  });
});

describe("AttributeFriction (§5.3)", () => {
  const SKILL = "55555555-5555-4555-8555-555555555555";
  const RESOURCE = "66666666-6666-4666-8666-666666666666";
  const MISSING = "99999999-9999-4999-8999-999999999999";

  let events: InMemoryFriction;
  let targets: StubAttributionTargets;

  beforeEach(() => {
    events = new InMemoryFriction();
    targets = new StubAttributionTargets();
  });

  function attribute(): AttributeFriction {
    return new AttributeFriction(events, targets);
  }

  async function anEvent(sessionId: string | null = null): Promise<string> {
    const logged = await new LogFriction(
      events,
      new FixedClock(NOW),
      new SequentialIdGenerator(),
    ).execute(ALICE, {
      type: "tooling",
      intensity: 3,
      ...(sessionId === null ? {} : { sessionId }),
    });
    return logged.id;
  }

  it("attributes friction to a skill and a resource", async () => {
    // Until this existed the columns were never written, so "your top friction source is tooling" was
    // the most specific thing M2's review screen could have said.
    const id = await anEvent();
    const after = await attribute().execute(ALICE, id, { skillId: SKILL, resourceId: RESOURCE });

    expect(after.skillId).toBe(SKILL);
    expect(after.resourceId).toBe(RESOURCE);
  });

  it("leaves the other one alone when only one is named", async () => {
    // Absent means unchanged, which is what makes two separate pickers possible.
    const id = await anEvent();
    await attribute().execute(ALICE, id, { skillId: SKILL });
    const after = await attribute().execute(ALICE, id, { resourceId: RESOURCE });

    expect(after.skillId).toBe(SKILL);
    expect(after.resourceId).toBe(RESOURCE);
  });

  it("retracts an attribution when given null", async () => {
    // "Actually this was not about that skill" has to be sayable, or a wrong guess is permanent.
    const id = await anEvent();
    await attribute().execute(ALICE, id, { skillId: SKILL });
    const after = await attribute().execute(ALICE, id, { skillId: null });

    expect(after.skillId).toBeNull();
  });

  it("changes nothing else about the event", async () => {
    // The type and the moment are what you tapped. Revising those would make the log a story.
    const id = await anEvent();
    const before = (await events.findById(ALICE, id))!.toSnapshot();
    const after = await attribute().execute(ALICE, id, { skillId: SKILL });

    expect(after.type).toBe(before.type);
    expect(after.intensity).toBe(before.intensity);
    expect(after.occurredAt).toEqual(before.occurredAt);
  });

  it("refuses a skill that does not exist rather than dying on the foreign key", async () => {
    const id = await anEvent();
    targets.missing.add(MISSING);

    await expect(attribute().execute(ALICE, id, { skillId: MISSING })).rejects.toBeInstanceOf(
      AttributionTargetMissing,
    );
  });

  it("refuses a missing resource too", async () => {
    const id = await anEvent();
    targets.missing.add(MISSING);

    await expect(attribute().execute(ALICE, id, { resourceId: MISSING })).rejects.toBeInstanceOf(
      AttributionTargetMissing,
    );
  });

  it("writes nothing when one of two targets is invalid", async () => {
    // Verified before the write, so a bad id cannot leave half the attribution applied.
    const id = await anEvent();
    targets.missing.add(MISSING);

    await expect(
      attribute().execute(ALICE, id, { skillId: SKILL, resourceId: MISSING }),
    ).rejects.toThrow();

    expect((await events.findById(ALICE, id))!.skillId).toBeNull();
  });

  it("does not look up a null, because a retraction has nothing to check", async () => {
    const id = await anEvent();
    targets.missing.add(MISSING);
    // Clearing both must work even while ids are unresolvable.
    await expect(
      attribute().execute(ALICE, id, { skillId: null, resourceId: null }),
    ).resolves.toBeDefined();
  });

  it("rejects an unknown event", async () => {
    await expect(attribute().execute(ALICE, MISSING, { skillId: SKILL })).rejects.toBeInstanceOf(
      FrictionEventNotFound,
    );
  });

  it("reports another user's event as not found", async () => {
    const id = await anEvent();
    await expect(attribute().execute(BOB, id, { skillId: SKILL })).rejects.toBeInstanceOf(
      FrictionEventNotFound,
    );
  });
});

describe("ListSessionFriction", () => {
  const SESSION = "77777777-7777-4777-8777-777777777777";

  it("returns a session's own events, oldest first", async () => {
    // You are recalling the block in the order it happened, not in the order a database returned it.
    const events = new InMemoryFriction();
    const log = new LogFriction(events, new FixedClock(NOW), new SequentialIdGenerator());

    // Backwards on purpose, and dated in the *past*: a future `occurredAt` is clamped to now, so two
    // events an hour apart would both land on `NOW` and the order would prove nothing.
    await log.execute(ALICE, {
      type: "tooling",
      intensity: 3,
      sessionId: SESSION,
      occurredAt: NOW,
    });
    await log.execute(ALICE, {
      type: "too_hard",
      intensity: 3,
      sessionId: SESSION,
      occurredAt: new Date(NOW.getTime() - 60_000),
    });

    const listed = await new ListSessionFriction(events).execute(ALICE, SESSION);
    expect(listed.map((event) => event.type)).toEqual(["too_hard", "tooling"]);
  });

  it("excludes events from other sessions and unattached ones", async () => {
    const events = new InMemoryFriction();
    const log = new LogFriction(events, new FixedClock(NOW), new SequentialIdGenerator());

    await log.execute(ALICE, { type: "tooling", intensity: 3, sessionId: SESSION });
    await log.execute(ALICE, { type: "avoidance", intensity: 3 });

    const listed = await new ListSessionFriction(events).execute(ALICE, SESSION);
    expect(listed).toHaveLength(1);
  });

  it("never returns another user's events", async () => {
    const events = new InMemoryFriction();
    const log = new LogFriction(events, new FixedClock(NOW), new SequentialIdGenerator());
    await log.execute(ALICE, { type: "tooling", intensity: 3, sessionId: SESSION });

    await expect(new ListSessionFriction(events).execute(BOB, SESSION)).resolves.toEqual([]);
  });
});
