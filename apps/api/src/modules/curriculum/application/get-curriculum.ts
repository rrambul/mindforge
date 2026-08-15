import {
  deriveLessons,
  missionProgress,
  moduleOutcomes,
  moduleProgress,
  nextLesson,
  orderModule,
  type CurriculumLesson,
  type CurriculumModule,
  type CurriculumView,
  type LessonNode,
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

/**
 * The wire shapes, derived from `packages/core`'s schemas rather than declared
 * here.
 *
 * They were declared here *and* in the SPA's `use-curriculum.ts`, linked by the
 * comment "Mirrors `LessonView`". Renaming a field on this side left every check
 * green and broke the screen at runtime, which is the whole reason the contract
 * moved. `CurriculumViewSchema` is what both ends now read.
 */
export type { CurriculumView, CurriculumLesson as LessonView, CurriculumModule as ModuleView };

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

    const modules = shown.map((track): CurriculumModule => {
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
      // Over the modules the screen shows, so the bar and the panels under it are
      // counting the same lessons. A fraction that silently included a dropped
      // module would not add up to anything on the page.
      progress: missionProgress(modules.map((module) => module.progress)),
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
