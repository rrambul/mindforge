import type { LessonStatus, Strain } from "@mindforge/core";

export const LESSON_LANDING_READER = Symbol("LessonLandingReader");

/** What a bridge request needs to know about one lesson (FR-D2). */
export interface LessonLanding {
  readonly missionId: string;
  readonly status: LessonStatus;
  readonly strain: Strain;
  /** A bridge toward it already exists. */
  readonly bridged: boolean;
}

export interface LessonLandingReader {
  /** Null when the lesson is not the user's — RLS makes that and "does not exist" one answer. */
  find(userId: string, lessonId: string): Promise<LessonLanding | null>;
}
