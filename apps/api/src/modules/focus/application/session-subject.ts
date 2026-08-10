import { Inject, Injectable } from "@nestjs/common";

import {
  LESSON_REPOSITORY,
  type LessonRepository,
} from "../../lessons/domain/lesson.repository.js";
import { FocusSessionLessonMismatch, FocusSessionLessonMissing } from "../domain/errors.js";
import type { FocusSessionAttachments } from "../domain/focus-session.js";

/**
 * What a block of attention was about (FR-F3).
 *
 * **The lesson decides the mission.** A lesson belongs to exactly one mission, so
 * a caller that sends a lesson has already said which mission it is — and the
 * database requires the pair to be complete
 * (`focus_sessions_lesson_implies_mission`). Deriving it here is what keeps
 * "binding is optional and never asked twice" true: the reader sends one id, and
 * the session comes back attributed to both.
 *
 * It reads the lessons module's repository rather than issuing its own query,
 * which is what makes the dependency declared — the alternative is a second place
 * that knows how a lesson's ownership is checked, and one of them eventually stops
 * checking.
 */
@Injectable()
export class ResolveSessionSubject {
  constructor(@Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository) {}

  async execute(
    userId: string,
    // `| undefined` spelled out because `exactOptionalPropertyTypes` is on: the
    // Zod-parsed body has optional keys that are genuinely absent, not null.
    input: {
      readonly missionId?: string | null | undefined;
      readonly lessonId?: string | null | undefined;
    },
  ): Promise<FocusSessionAttachments> {
    const lessonId = input.lessonId ?? null;
    const missionId = input.missionId ?? null;

    if (lessonId === null) return { missionId, lessonId: null };

    // RLS answers ownership: a lesson that is not this user's returns no row, so
    // "somebody else's lesson" and "no such lesson" are the same refusal.
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new FocusSessionLessonMissing(lessonId);

    if (missionId !== null && missionId !== lesson.missionId) {
      throw new FocusSessionLessonMismatch(lessonId, missionId);
    }

    return { missionId: lesson.missionId, lessonId };
  }
}
