import {
  CreateFocusSessionSchema,
  DebriefFocusSessionSchema,
  ListFocusSessionsQuerySchema,
  StartFocusSessionSchema,
  UuidSchema,
  elapsedMinutes,
  type CreateFocusSessionInput,
  type DebriefFocusSessionInput,
  type EntryMode,
  type IntentionOutcome,
  type ListFocusSessionsQuery,
  type StartFocusSessionInput,
} from "@mindforge/core";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  DebriefFocusSession,
  RecordFocusSession,
  StartFocusSession,
  StopFocusSession,
} from "../application/focus-session.commands.js";
import { GetRunningFocusSession, ListFocusSessions } from "../application/read-focus-sessions.js";
import type { FocusSession } from "../domain/focus-session.js";

/**
 * What a focus session looks like on the wire.
 *
 * `elapsedMinutes` is sent for a finished session and withheld for a running one, because a
 * running session's elapsed time is a function of *now* — the client ticks it locally, and a
 * server-rendered figure would be stale the instant it arrived.
 */
export interface FocusSessionView {
  readonly id: string;
  readonly intention: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly plannedMinutes: number | null;
  readonly minutes: number | null;
  readonly isRunning: boolean;
  readonly entryMode: EntryMode;
  readonly hitIntention: IntentionOutcome | null;
  readonly focusQuality: number | null;
  readonly energy: number | null;
  readonly note: string | null;
  readonly missionId: string | null;
  /** The lesson the time was spent on, when the block was started from the reader (FR-F3). */
  readonly lessonId: string | null;
}

export function toFocusSessionView(session: FocusSession): FocusSessionView {
  const s = session.toSnapshot();
  return {
    id: s.id,
    intention: s.intention,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt?.toISOString() ?? null,
    plannedMinutes: s.plannedMinutes,
    minutes: s.endedAt === null ? null : elapsedMinutes(s.startedAt, s.endedAt),
    isRunning: s.endedAt === null,
    entryMode: s.entryMode,
    hitIntention: s.hitIntention,
    focusQuality: s.focusQuality,
    energy: s.energy,
    note: s.note,
    missionId: s.missionId,
    lessonId: s.lessonId,
  };
}

/**
 * `/v1/focus` (§6).
 *
 * `start`, `stop`, and `debrief` are separate calls on purpose, and the split is the ≤5s
 * budget: stopping is one tap with no body, and the thirty-second debrief is a second request
 * you may never make. Folding the debrief into stop would put a form between you and ending
 * a block.
 */
@Controller("focus")
export class FocusController {
  constructor(
    private readonly startSession: StartFocusSession,
    private readonly stopSession: StopFocusSession,
    private readonly debriefSession: DebriefFocusSession,
    private readonly recordSession: RecordFocusSession,
    private readonly running: GetRunningFocusSession,
    private readonly list: ListFocusSessions,
  ) {}

  /**
   * The Today screen's first question. Answers with an envelope rather than `null` so the
   * response is a JSON object either way — a bare `null` body is awkward for every client.
   */
  @Get("sessions/running")
  async getRunning(
    @CurrentUser() user: RequestContext,
  ): Promise<{ session: FocusSessionView | null }> {
    const session = await this.running.execute(user.userId);
    return { session: session ? toFocusSessionView(session) : null };
  }

  @Get("sessions")
  async listSessions(
    @CurrentUser() user: RequestContext,
    @Query(zodPipe(ListFocusSessionsQuerySchema)) query: ListFocusSessionsQuery,
  ): Promise<{ sessions: FocusSessionView[] }> {
    const sessions = await this.list.execute(user.userId, query);
    return { sessions: sessions.map(toFocusSessionView) };
  }

  @Post("sessions/start")
  async start(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(StartFocusSessionSchema)) body: StartFocusSessionInput,
  ): Promise<FocusSessionView> {
    return toFocusSessionView(await this.startSession.execute(user.userId, body));
  }

  @Post("sessions/:id/stop")
  async stop(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
  ): Promise<FocusSessionView> {
    return toFocusSessionView(await this.stopSession.execute(user.userId, id));
  }

  @Post("sessions/:id/debrief")
  async debrief(
    @CurrentUser() user: RequestContext,
    @Param("id", zodPipe(UuidSchema)) id: string,
    @Body(zodPipe(DebriefFocusSessionSchema)) body: DebriefFocusSessionInput,
  ): Promise<FocusSessionView> {
    return toFocusSessionView(await this.debriefSession.execute(user.userId, id, body));
  }

  /** Manual and retroactive entry (FR-F2). */
  @Post("sessions")
  async record(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(CreateFocusSessionSchema)) body: CreateFocusSessionInput,
  ): Promise<FocusSessionView> {
    return toFocusSessionView(await this.recordSession.execute(user.userId, body, user.timezone));
  }
}
