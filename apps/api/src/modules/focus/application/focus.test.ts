import { beforeEach, describe, expect, it } from "vitest";
import { SequentialIdGenerator } from "../../../shared/ids/id-generator.js";
import { FixedClock } from "../../../shared/time/clock.js";
import type { LessonRecord, LessonRepository } from "../../lessons/domain/lesson.repository.js";
import {
  FocusSessionAlreadyRunning,
  FocusSessionNotFound,
  FocusSessionNotStopped,
} from "../domain/errors.js";
import type { FocusSession } from "../domain/focus-session.js";
import type {
  FocusSessionFilter,
  FocusSessionRepository,
} from "../domain/focus-session.repository.js";
import {
  DebriefFocusSession,
  RecordFocusSession,
  StartFocusSession,
  StopFocusSession,
} from "./focus-session.commands.js";
import { GetRunningFocusSession, ListFocusSessions } from "./read-focus-sessions.js";
import { ResolveSessionSubject } from "./session-subject.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-05T09:00:00Z");

/** Keyed by user even though RLS would do it, so a use case that dropped userId fails here. */
class InMemorySessions implements FocusSessionRepository {
  private readonly byUser = new Map<string, Map<string, FocusSession>>();
  saveCount = 0;

  private own(userId: string): Map<string, FocusSession> {
    const existing = this.byUser.get(userId);
    if (existing) return existing;
    const created = new Map<string, FocusSession>();
    this.byUser.set(userId, created);
    return created;
  }

  findById(userId: string, id: string): Promise<FocusSession | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  findRunning(userId: string): Promise<FocusSession | null> {
    return Promise.resolve([...this.own(userId).values()].find((s) => s.isRunning) ?? null);
  }

  list(userId: string, filter: FocusSessionFilter): Promise<FocusSession[]> {
    let all = [...this.own(userId).values()].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
    if (filter.missionId) all = all.filter((s) => s.attachments.missionId === filter.missionId);
    if (filter.since) all = all.filter((s) => s.startedAt >= filter.since!);
    if (filter.limit !== undefined) all = all.slice(0, filter.limit);
    return Promise.resolve(all);
  }

  save(userId: string, session: FocusSession): Promise<void> {
    this.saveCount += 1;
    this.own(userId).set(session.id, session);
    return Promise.resolve();
  }
}

/**
 * The lessons a session may bind to (FR-F3).
 *
 * Keyed by user for the same reason the sessions are: a resolver that dropped
 * `userId` would happily attach Bob's lesson to Alice's afternoon, and RLS cannot
 * see that mistake because the row it writes is Alice's own.
 */
const ALICE_LESSON = "88888888-8888-4888-8888-888888888888";
const BOB_LESSON = "99999999-9999-4999-8999-999999999999";
const ALICE_MISSION = "55555555-5555-4555-8555-555555555555";

class InMemoryLessons implements LessonRepository {
  private readonly rows = new Map<string, LessonRecord>([
    [`${ALICE}:${ALICE_LESSON}`, lessonRecord(ALICE_LESSON, ALICE_MISSION)],
    [`${BOB}:${BOB_LESSON}`, lessonRecord(BOB_LESSON, "66666666-6666-4666-8666-666666666666")],
  ]);

  findById(userId: string, id: string): Promise<LessonRecord | null> {
    return Promise.resolve(this.rows.get(`${userId}:${id}`) ?? null);
  }

  setCompletion(): Promise<void> {
    return Promise.resolve();
  }
}

function lessonRecord(id: string, missionId: string): LessonRecord {
  return {
    id,
    missionId,
    trackId: null,
    moduleName: null,
    slug: "borrow-checker",
    title: "Borrow checker errors",
    intent: null,
    status: "generated",
    difficulty: null,
    depth: null,
    seq: 7,
    storagePath: "workspaces/u/k/lessons/0007-borrow-checker.html",
    workspaceKey: "k",
    completedAt: null,
    outcome: null,
  };
}

function subject(): ResolveSessionSubject {
  return new ResolveSessionSubject(new InMemoryLessons());
}

describe("StartFocusSession", () => {
  let sessions: InMemorySessions;
  let clock: FixedClock;
  let start: StartFocusSession;

  beforeEach(() => {
    sessions = new InMemorySessions();
    clock = new FixedClock(NOW);
    start = new StartFocusSession(sessions, clock, new SequentialIdGenerator(), subject());
  });

  it("starts a running session from nothing", async () => {
    const session = await start.execute(ALICE, {});
    expect(session.isRunning).toBe(true);
    expect(session.id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("refuses a second concurrent session", async () => {
    // Two blocks of attention at once has no meaning, and the app should not pretend it does.
    await start.execute(ALICE, {});
    await expect(start.execute(ALICE, {})).rejects.toBeInstanceOf(FocusSessionAlreadyRunning);
  });

  it("reports which session is in the way, so the UI can offer to stop it", async () => {
    const first = await start.execute(ALICE, {});
    await expect(start.execute(ALICE, {})).rejects.toMatchObject({
      slug: "focus-session-already-running",
      message: expect.stringContaining(first.id) as unknown as string,
    });
  });

  it("does not auto-stop the running session", async () => {
    // Auto-stopping would silently end a block whose debrief you never got to write.
    const first = await start.execute(ALICE, {});
    await start.execute(ALICE, {}).catch(() => undefined);
    await expect(sessions.findById(ALICE, first.id)).resolves.toMatchObject({ isRunning: true });
  });

  it("lets a second user start while the first is running", async () => {
    await start.execute(ALICE, {});
    await expect(start.execute(BOB, {})).resolves.toMatchObject({ isRunning: true });
  });

  it("starts again once the first has been stopped", async () => {
    const first = await start.execute(ALICE, {});
    await new StopFocusSession(sessions, clock).execute(ALICE, first.id);

    clock.advance(60_000);
    await expect(start.execute(ALICE, {})).resolves.toMatchObject({ isRunning: true });
  });

  describe("idempotency (§6.1)", () => {
    it("returns the existing session when a client id is replayed", async () => {
      // The offline queue cannot know whether its first attempt landed, so "already there" has
      // to be a success. A 409 here would surface to the user as an error they cannot act on.
      const id = "33333333-3333-4333-8333-333333333333";
      const first = await start.execute(ALICE, { id, intention: "first" });
      const replay = await start.execute(ALICE, { id, intention: "different" });

      expect(replay.id).toBe(first.id);
      // The replay must not overwrite what the original recorded.
      expect(replay.intention).toBe("first");
      expect(sessions.saveCount).toBe(1);
    });

    it("returns a replayed start even after that session was stopped", async () => {
      const id = "33333333-3333-4333-8333-333333333333";
      await start.execute(ALICE, { id });
      await new StopFocusSession(sessions, clock).execute(ALICE, id);

      const replay = await start.execute(ALICE, { id });
      expect(replay.isRunning).toBe(false);
    });

    it("does not let one user's id collide with another's", async () => {
      const id = "33333333-3333-4333-8333-333333333333";
      await start.execute(ALICE, { id, intention: "alice's" });
      await expect(start.execute(BOB, { id })).resolves.toMatchObject({ intention: null });
    });
  });
});

describe("StopFocusSession", () => {
  let sessions: InMemorySessions;
  let clock: FixedClock;
  let stop: StopFocusSession;

  beforeEach(() => {
    sessions = new InMemorySessions();
    clock = new FixedClock(NOW);
    stop = new StopFocusSession(sessions, clock);
  });

  it("ends a running session", async () => {
    const started = await new StartFocusSession(
      sessions,
      clock,
      new SequentialIdGenerator(),
      subject(),
    ).execute(ALICE, {});

    clock.advance(40 * 60_000);
    const stopped = await stop.execute(ALICE, started.id);

    expect(stopped.isRunning).toBe(false);
    expect(stopped.minutes).toBe(40);
  });

  it("is idempotent — a replayed stop is not a conflict", async () => {
    const started = await new StartFocusSession(
      sessions,
      clock,
      new SequentialIdGenerator(),
      subject(),
    ).execute(ALICE, {});
    clock.advance(60_000);

    const first = await stop.execute(ALICE, started.id);
    clock.advance(60_000);
    const replay = await stop.execute(ALICE, started.id);

    // And crucially the end time does not move: the block ended when it ended.
    expect(replay.endedAt).toEqual(first.endedAt);
  });

  it("rejects an unknown session", async () => {
    await expect(
      stop.execute(ALICE, "44444444-4444-4444-8444-444444444444"),
    ).rejects.toBeInstanceOf(FocusSessionNotFound);
  });

  it("rejects another user's session as not found", async () => {
    const bobs = await new StartFocusSession(
      sessions,
      clock,
      new SequentialIdGenerator(),
      subject(),
    ).execute(BOB, {});
    await expect(stop.execute(ALICE, bobs.id)).rejects.toBeInstanceOf(FocusSessionNotFound);
  });
});

describe("DebriefFocusSession", () => {
  let sessions: InMemorySessions;
  let clock: FixedClock;
  let debrief: DebriefFocusSession;

  beforeEach(() => {
    sessions = new InMemorySessions();
    clock = new FixedClock(NOW);
    debrief = new DebriefFocusSession(sessions);
  });

  async function stoppedSession(): Promise<FocusSession> {
    const started = await new StartFocusSession(
      sessions,
      clock,
      new SequentialIdGenerator(),
      subject(),
    ).execute(ALICE, {});
    clock.advance(40 * 60_000);
    return new StopFocusSession(sessions, clock).execute(ALICE, started.id);
  }

  it("records the ≤30s debrief", async () => {
    const session = await stoppedSession();
    const after = await debrief.execute(ALICE, session.id, {
      hitIntention: "partly",
      focusQuality: 4,
      energy: 3,
    });

    expect(after.debrief).toEqual({
      hitIntention: "partly",
      focusQuality: 4,
      energy: 3,
      note: null,
    });
  });

  it("accepts a partial debrief and merges a later one", async () => {
    const session = await stoppedSession();
    await debrief.execute(ALICE, session.id, { hitIntention: "yes" });
    const after = await debrief.execute(ALICE, session.id, { energy: 2 });

    expect(after.debrief.hitIntention).toBe("yes");
    expect(after.debrief.energy).toBe(2);
  });

  it("refuses to debrief a session that is still running", async () => {
    const started = await new StartFocusSession(
      sessions,
      clock,
      new SequentialIdGenerator(),
      subject(),
    ).execute(ALICE, {});

    await expect(
      debrief.execute(ALICE, started.id, { hitIntention: "yes" }),
    ).rejects.toBeInstanceOf(FocusSessionNotStopped);
  });

  it("rejects another user's session as not found", async () => {
    const session = await stoppedSession();
    await expect(debrief.execute(BOB, session.id, { energy: 3 })).rejects.toBeInstanceOf(
      FocusSessionNotFound,
    );
  });
});

describe("RecordFocusSession", () => {
  let sessions: InMemorySessions;
  let record: RecordFocusSession;

  beforeEach(() => {
    sessions = new InMemorySessions();
    record = new RecordFocusSession(
      sessions,
      new FixedClock(new Date("2026-08-05T22:00:00Z")),
      new SequentialIdGenerator(),
      subject(),
    );
  });

  it("records a session you forgot to time (FR-F2)", async () => {
    const session = await record.execute(
      ALICE,
      {
        startedAt: new Date("2026-08-05T09:00:00Z"),
        endedAt: new Date("2026-08-05T10:30:00Z"),
        intention: "read chapter 4",
        hitIntention: "yes",
      },
      "America/Sao_Paulo",
    );

    expect(session.minutes).toBe(90);
    expect(session.entryMode).toBe("manual");
    expect(session.isRunning).toBe(false);
  });

  it("does not care that a session is currently running", async () => {
    // A block entered after the fact is unrelated to whatever is running now. Refusing it would
    // mean stopping your current session to record a forgotten one.
    await new StartFocusSession(
      sessions,
      new FixedClock(new Date("2026-08-05T21:00:00Z")),
      new SequentialIdGenerator(),
      subject(),
    ).execute(ALICE, {});

    await expect(
      record.execute(
        ALICE,
        {
          startedAt: new Date("2026-08-05T09:00:00Z"),
          endedAt: new Date("2026-08-05T10:00:00Z"),
        },
        "America/Sao_Paulo",
      ),
    ).resolves.toMatchObject({ isRunning: false });
  });

  it("is idempotent on a replayed id", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const input = {
      id,
      startedAt: new Date("2026-08-05T09:00:00Z"),
      endedAt: new Date("2026-08-05T10:00:00Z"),
    };
    await record.execute(ALICE, input, "America/Sao_Paulo");
    await record.execute(ALICE, input, "America/Sao_Paulo");
    expect(sessions.saveCount).toBe(1);
  });
});

describe("reads", () => {
  let sessions: InMemorySessions;
  let clock: FixedClock;

  beforeEach(() => {
    sessions = new InMemorySessions();
    clock = new FixedClock(NOW);
  });

  it("answers whether something is running", async () => {
    const running = new GetRunningFocusSession(sessions);
    await expect(running.execute(ALICE)).resolves.toBeNull();

    await new StartFocusSession(sessions, clock, new SequentialIdGenerator(), subject()).execute(
      ALICE,
      {},
    );
    await expect(running.execute(ALICE)).resolves.not.toBeNull();
  });

  it("never reports another user's running session", async () => {
    await new StartFocusSession(sessions, clock, new SequentialIdGenerator(), subject()).execute(
      BOB,
      {},
    );
    await expect(new GetRunningFocusSession(sessions).execute(ALICE)).resolves.toBeNull();
  });

  it("caps the list, because sessions are the one M1 list that grows without bound", async () => {
    const start = new StartFocusSession(sessions, clock, new SequentialIdGenerator(), subject());
    const stop = new StopFocusSession(sessions, clock);
    for (let i = 0; i < 60; i += 1) {
      const session = await start.execute(ALICE, {});
      clock.advance(60_000);
      await stop.execute(ALICE, session.id);
      clock.advance(60_000);
    }

    await expect(new ListFocusSessions(sessions).execute(ALICE, {})).resolves.toHaveLength(50);
  });

  it("filters by mission", async () => {
    const mission = "55555555-5555-4555-8555-555555555555";
    const start = new StartFocusSession(sessions, clock, new SequentialIdGenerator(), subject());
    const stop = new StopFocusSession(sessions, clock);

    const first = await start.execute(ALICE, { missionId: mission });
    clock.advance(60_000);
    await stop.execute(ALICE, first.id);
    clock.advance(60_000);
    const second = await start.execute(ALICE, {});
    clock.advance(60_000);
    await stop.execute(ALICE, second.id);

    const listed = await new ListFocusSessions(sessions).execute(ALICE, { missionId: mission });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.attachments.missionId).toBe(mission);
  });
});

/**
 * Binding a block of attention to the lesson it was spent on (FR-F3).
 *
 * "Optional and never asked twice" is the requirement, and the shape below is what
 * it means in practice: the reader sends one id, the mission comes with it, and
 * nothing anywhere prompts for either.
 */
describe("what a session was about", () => {
  let sessions: InMemorySessions;
  let start: StartFocusSession;

  beforeEach(() => {
    sessions = new InMemorySessions();
    start = new StartFocusSession(
      sessions,
      new FixedClock(NOW),
      new SequentialIdGenerator(),
      subject(),
    );
  });

  it("takes the mission from the lesson, so the reader sends one id", async () => {
    const session = await start.execute(ALICE, { lessonId: ALICE_LESSON });

    expect(session.attachments).toEqual({ missionId: ALICE_MISSION, lessonId: ALICE_LESSON });
  });

  it("leaves both unset when nothing was named", async () => {
    // Most sessions. A timer started from Today is about the day, not a lesson.
    expect((await start.execute(ALICE, {})).attachments).toEqual({
      missionId: null,
      lessonId: null,
    });
  });

  it("refuses a lesson that is not yours", async () => {
    // RLS cannot catch this: the *session* is Alice's, and only the id is Bob's.
    // Silently dropping the binding would record her time against nothing, and
    // she would find out in M6 when the lesson showed zero minutes.
    await expect(start.execute(ALICE, { lessonId: BOB_LESSON })).rejects.toMatchObject({
      slug: "focus-session-lesson-missing",
      violations: [{ field: "lessonId", code: "not_found" }],
    });
  });

  it("refuses a lesson and a mission that disagree", async () => {
    // A replayed offline capture can produce this. Resolved either way it is a
    // silent move: to the lesson's mission, or to a pair the time views argue about.
    await expect(
      start.execute(ALICE, {
        lessonId: ALICE_LESSON,
        missionId: "77777777-7777-4777-8777-777777777777",
      }),
    ).rejects.toMatchObject({ slug: "focus-session-lesson-mismatch" });
  });

  it("refuses before it refuses a second running session", async () => {
    // The caller can fix a bad lesson id; they cannot fix "something else is
    // running" without abandoning what they asked for.
    await start.execute(ALICE, {});

    await expect(start.execute(ALICE, { lessonId: BOB_LESSON })).rejects.toMatchObject({
      slug: "focus-session-lesson-missing",
    });
  });

  it("binds a backfilled session too — a block you enter later had a subject", async () => {
    const record = new RecordFocusSession(
      sessions,
      new FixedClock(new Date("2026-08-05T22:00:00Z")),
      new SequentialIdGenerator(),
      subject(),
    );

    const session = await record.execute(
      ALICE,
      {
        startedAt: new Date("2026-08-05T19:00:00Z"),
        endedAt: new Date("2026-08-05T20:00:00Z"),
        lessonId: ALICE_LESSON,
      },
      "UTC",
    );

    expect(session.attachments.lessonId).toBe(ALICE_LESSON);
  });
});
