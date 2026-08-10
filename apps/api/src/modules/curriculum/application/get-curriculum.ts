import {
  deriveLessons,
  moduleOutcomes,
  moduleProgress,
  nextLesson,
  orderModule,
  type LessonDepth,
  type LessonNode,
  type LessonOutcome,
  type LessonStatus,
  type ModuleProgress,
  type OutcomeCounts,
} from "@mindforge/core";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
  CURRICULUM_READER,
  type CurriculumReader,
  type LessonRow,
  type TrackRow,
} from "./curriculum.port.js";

/**
 * The curriculum screen's read side (FR-K5).
 *
 * No `domain/` layer, for the reason the insights module gives: nothing here
 * writes, and the maths that would be domain logic already lives in
 * `packages/core` — the SPA renders the same locked states and the same fractions,
 * and non-negotiable 3 forbids a second implementation. This use case is the
 * join between the rows and those functions, and nothing else.
 *
 * **Everything derived is derived here, on read.** Nothing on the wire is stored:
 * `fundamental` is a count over `lesson_edges`, `unblocked` is every prerequisite
 * completed, and `progress` is counted at the moment you ask.
 */

export interface LessonView {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly intent: string | null;
  readonly status: LessonStatus;
  /** 1–5 for this learner, or null when the plan did not say. Never defaulted. */
  readonly difficulty: number | null;
  readonly depth: LessonDepth | null;
  readonly completed: boolean;
  /** understood | shaky | lost, written by the reader (FR-P1). */
  readonly outcome: LessonOutcome | null;
  readonly unblocked: boolean;
  /** Titles of the prerequisites still unfinished, so the lock has a reason. */
  readonly blockedBy: readonly string[];
  /** How many lessons depend on this one (FR-K6). Zero is the count, not a badge. */
  readonly dependentCount: number;
}

export interface ModuleView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly outcome: string | null;
  readonly status: string;
  readonly prerequisites: readonly string[];
  /** Null when the module has no lessons at all: not planned yet, never 0%. */
  readonly progress: ModuleProgress | null;
  /**
   * How the finished ones landed (FR-P4). Null for the same reason `progress` is.
   *
   * Includes `unrecorded`, so the four sum to `progress.completed` — a
   * distribution that dropped the completions made before an outcome could be
   * recorded would show three outcomes out of five finished lessons and leave the
   * reader to guess at the other two.
   */
  readonly outcomes: OutcomeCounts | null;
  readonly lessons: readonly LessonView[];
}

export interface CurriculumView {
  readonly missionId: string;
  readonly modules: readonly ModuleView[];
  /** The first unblocked, unfinished lesson across the whole plan (FR-K7). */
  readonly nextLessonId: string | null;
}

@Injectable()
export class GetCurriculum {
  constructor(@Inject(CURRICULUM_READER) private readonly curriculum: CurriculumReader) {}

  async execute(userId: string, missionId: string): Promise<CurriculumView> {
    const rows = await this.curriculum.read(userId, missionId);
    if (rows === null) throw new NotFoundException("mission_not_found");

    const nodes = rows.lessons.map(toNode);
    const derived = deriveLessons(nodes);
    const titles = new Map(rows.lessons.map((lesson) => [lesson.id, lesson.title]));
    const byId = new Map(rows.lessons.map((lesson) => [lesson.id, lesson]));

    const shown = rows.tracks.filter((track) => isShown(track, rows.lessons));
    const order = shown.map((track) => track.id);

    const modules = shown.map((track): ModuleView => {
      const inModule = nodes.filter((node) => node.trackId === track.id);

      return {
        id: track.id,
        slug: track.slug,
        name: track.name,
        outcome: track.outcome,
        status: track.status,
        prerequisites: track.prerequisites,
        progress: moduleProgress(inModule),
        outcomes: moduleOutcomes(
          inModule.map((node) => ({
            completed: node.completed,
            outcome: byId.get(node.id)!.outcome,
          })),
        ),
        lessons: orderModule(inModule).map((node) => {
          const row = byId.get(node.id)!;
          const state = derived.get(node.id)!;

          return {
            id: row.id,
            slug: row.slug,
            title: row.title,
            intent: row.intent,
            status: row.status,
            difficulty: row.difficulty,
            depth: row.depth,
            completed: node.completed,
            outcome: row.outcome,
            unblocked: state.unblocked,
            // Titles rather than ids: the lock is rendered as a sentence, and an
            // id in it would be a reason nobody can read.
            blockedBy: state.blockedBy.map((id) => titles.get(id)).filter(isString),
            dependentCount: state.dependentCount,
          };
        }),
      };
    });

    return {
      missionId,
      modules,
      // Over every lesson, not only the shown modules': a lesson can be locked by
      // one in a module this screen hides, and the answer must not change because
      // of what is on screen.
      nextLessonId: nextLesson(nodes, order)?.id ?? null,
    };
  }
}

function toNode(lesson: LessonRow): LessonNode {
  return {
    id: lesson.id,
    trackId: lesson.trackId,
    status: lesson.status,
    difficulty: lesson.difficulty,
    position: lesson.position,
    seq: lesson.seq,
    completed: lesson.completedAt !== null,
    prerequisiteIds: lesson.prerequisiteIds,
  };
}

/**
 * Which modules the screen shows.
 *
 * A dropped module is one a regenerated `CURRICULUM.md` stopped mentioning. It is
 * retained rather than deleted because it may hold finished lessons — so it is
 * shown when it does, and hidden when it is an empty row the plan has moved past.
 * Hiding it either way would make a learner's own finished work disappear from the
 * only screen that lists it.
 */
function isShown(track: TrackRow, lessons: readonly LessonRow[]): boolean {
  if (track.status !== "dropped") return true;
  return lessons.some((lesson) => lesson.trackId === track.id && lesson.status === "generated");
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
