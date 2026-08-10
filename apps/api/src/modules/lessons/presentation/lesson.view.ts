import type { LessonDepth, LessonOutcome, LessonStatus } from "@mindforge/core";

import type { OpenedLesson } from "../application/lessons.use-cases.js";

/**
 * A lesson on the wire.
 *
 * `view` is the whole of what makes the reader work and the only thing here that
 * expires — so it carries its own `expiresAt` rather than the client inferring one
 * from a TTL it would have to be told about separately.
 *
 * Null means "there is nothing to open", which is a real and common state: a
 * planned lesson has no file. The reader distinguishes it from a failure, because
 * "not written yet" is an invitation and an error is not.
 */
export interface LessonView {
  readonly id: string;
  readonly missionId: string;
  readonly trackId: string | null;
  readonly moduleName: string | null;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: LessonStatus;
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly seq: number | null;
  readonly completedAt: string | null;
  readonly outcome: LessonOutcome | null;
  readonly view: { readonly url: string; readonly expiresAt: string } | null;
}

export function toLessonView(opened: OpenedLesson): LessonView {
  const { lesson } = opened;

  return {
    id: lesson.id,
    missionId: lesson.missionId,
    trackId: lesson.trackId,
    moduleName: lesson.moduleName,
    slug: lesson.slug,
    title: lesson.title,
    intent: lesson.intent,
    status: lesson.status,
    difficulty: lesson.difficulty,
    depth: lesson.depth,
    seq: lesson.seq,
    completedAt: lesson.completedAt?.toISOString() ?? null,
    outcome: lesson.outcome,
    view:
      opened.view === null
        ? null
        : { url: opened.view.url, expiresAt: opened.view.expiresAt.toISOString() },
  };
}
