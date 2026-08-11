import type { LessonOutcome } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { LessonNotFound, LessonNotWritten } from "../domain/errors.js";
import {
  LESSON_REPOSITORY,
  type LessonRecord,
  type LessonRepository,
} from "../domain/lesson.repository.js";
import { ViewGrants, viewUrlFor } from "./view-grants.js";

/**
 * One lesson, and the URL that opens it.
 *
 * `view` is null for a lesson that has no file — a planned row, or one whose
 * mission has never been materialised. Null rather than a URL that 404s: the
 * reader renders "not written yet" and offers to have it taught, which is a
 * different screen from "something went wrong".
 */
export interface OpenedLesson {
  readonly lesson: LessonRecord;
  readonly view: { readonly url: string; readonly expiresAt: Date } | null;
}

@Injectable()
export class GetLesson {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    private readonly grants: ViewGrants,
  ) {}

  async execute(userId: string, lessonId: string): Promise<OpenedLesson> {
    const lesson = await this.lessons.findById(userId, lessonId);
    // RLS answered the ownership question: a lesson that is not this user's
    // returns no row, and "not yours" and "does not exist" are one answer.
    if (lesson === null) throw new LessonNotFound(lessonId);

    return { lesson, view: await this.viewFor(userId, lesson) };
  }

  private async viewFor(userId: string, lesson: LessonRecord): Promise<OpenedLesson["view"]> {
    if (lesson.storagePath === null || lesson.workspaceKey === null) return null;

    const grant = await this.grants.mint(userId, lesson.workspaceKey);

    return { url: viewUrlFor(grant, lesson.storagePath), expiresAt: grant.expiresAt };
  }
}

/**
 * Finishing a lesson, from the reader (FR-P1).
 *
 * Idempotent, and re-completing is how you revise: marking a lesson `shaky` today
 * and `understood` after redoing it next week overwrites the outcome and moves
 * `completed_at` forward. Nothing is appended, because a module's fraction counts
 * lessons and not attempts — and a lesson finished twice is still one lesson.
 *
 * **A planned lesson cannot be completed.** The database says so too
 * (`lessons_planned_not_completed`), and it is said here as well so the answer is
 * a 409 the reader can act on rather than a constraint violation nobody was
 * expecting to meet.
 */
@Injectable()
export class CompleteLesson {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly get: GetLesson,
  ) {}

  async execute(userId: string, lessonId: string, outcome: LessonOutcome): Promise<OpenedLesson> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);
    if (lesson.status === "planned") throw new LessonNotWritten(lessonId);

    await this.lessons.setCompletion(userId, lessonId, {
      completedAt: this.clock.now(),
      outcome,
    });

    return this.get.execute(userId, lessonId);
  }
}

/**
 * Undoing a completion.
 *
 * Not a way to make a bad week look better: the outcome you record stays until you
 * record another one, and there is no decay of any kind (non-negotiable 10). This
 * exists because a three-button tray on a phone gets mis-tapped, and a wrong
 * outcome you cannot clear is a number that lies for as long as the module does.
 */
@Injectable()
export class ClearLessonCompletion {
  constructor(
    @Inject(LESSON_REPOSITORY) private readonly lessons: LessonRepository,
    private readonly get: GetLesson,
  ) {}

  async execute(userId: string, lessonId: string): Promise<OpenedLesson> {
    const lesson = await this.lessons.findById(userId, lessonId);
    if (lesson === null) throw new LessonNotFound(lessonId);

    // No guard on "was it completed": clearing an already-clear lesson is what the
    // caller asked for and already true, and a 409 there would be an error message
    // about a state the user wanted.
    if (lesson.completedAt !== null) await this.lessons.setCompletion(userId, lessonId, null);

    return this.get.execute(userId, lessonId);
  }
}
