/**
 * The lesson graph: what is fundamental, what is unblocked, what is next, and how
 * far through a module you are (FR-K6, FR-K7, FR-P2; TECH-DESIGN §3.2b).
 *
 * **Nothing here is ever stored.** `lesson_edges` records one fact — "A depends on
 * B" — and every derived reading of it is computed here, on read, by the API and
 * the SPA calling the same functions (non-negotiable 3). A stored `fundamental`
 * flag is a value that was true once; a stored progress fraction is a number that
 * was true before the plan was revised.
 *
 * The three rules that shape the code:
 *
 * 1. **Unknown is not zero.** A module with no lessons has no denominator, so
 *    `moduleProgress` returns null rather than `0/0` — the UI says "not planned
 *    yet" rather than drawing an empty bar, which would be a measurement claim
 *    about something unmeasured (non-negotiable 10).
 *
 * 2. **Fundamental is a count, not a badge.** A lesson is fundamental *because*
 *    other lessons depend on it, and the more that do the more fundamental it is.
 *    The count is returned rather than a boolean so the UI can rank by it (FR-K6).
 *
 * 3. **Difficulty orders, dependencies gate.** Within a module the plan's own
 *    order is the tie-break and difficulty is the sort; what may be started at all
 *    is decided only by whether every prerequisite is finished (FR-K7).
 */

/** How far down a lesson goes. Stored as these keys; the UI translates them. */
export type LessonDepth = "overview" | "working" | "deep_dive";

/** A row `CURRICULUM.md` planned, or one `teach` wrote. */
export type LessonStatus = "planned" | "generated";

/**
 * One lesson, as much of it as any derivation here needs.
 *
 * Deliberately not the whole row: this runs in the SPA bundle as well as the API,
 * and a shape that named `storagePath` or `contentHash` would invite a caller to
 * pass a lesson's content through a maths function.
 */
export interface LessonNode {
  readonly id: string;
  /** Null for a lesson taught off-plan or written before the curriculum existed. */
  readonly trackId: string | null;
  readonly status: LessonStatus;
  /** 1–5 relative to this learner, or null when the plan did not say. */
  readonly difficulty: number | null;
  /** The plan's row order within its module, or null off-plan. */
  readonly position: number | null;
  /** From the filename, once the lesson has one. */
  readonly seq: number | null;
  readonly completed: boolean;
  readonly prerequisiteIds: readonly string[];
}

export interface DerivedLesson {
  readonly id: string;
  /** How many lessons name this one as a prerequisite (FR-K6). */
  readonly dependentCount: number;
  /** `dependentCount > 0`. Kept beside the count so the UI can badge and rank. */
  readonly fundamental: boolean;
  /** Every prerequisite completed (FR-K7). Says nothing about this lesson itself. */
  readonly unblocked: boolean;
  /** Prerequisites still to finish, so the UI can say *why* something is locked. */
  readonly blockedBy: readonly string[];
}

export interface ModuleProgress {
  readonly completed: number;
  readonly total: number;
}

/**
 * Every lesson's derived state, keyed by id.
 *
 * A prerequisite id that names no lesson in the set does not block anything.
 * `lesson_edges` cascades on delete so the database cannot produce that state, but
 * a caller filtering to one module can — and a lesson locked behind a
 * prerequisite the caller chose not to load would be locked forever, with nothing
 * on screen to explain it.
 */
export function deriveLessons(lessons: readonly LessonNode[]): ReadonlyMap<string, DerivedLesson> {
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const dependents = new Map<string, number>();

  for (const lesson of lessons) {
    for (const prereqId of lesson.prerequisiteIds) {
      if (!byId.has(prereqId)) continue;
      dependents.set(prereqId, (dependents.get(prereqId) ?? 0) + 1);
    }
  }

  const derived = new Map<string, DerivedLesson>();

  for (const lesson of lessons) {
    const blockedBy = lesson.prerequisiteIds.filter((id) => byId.get(id)?.completed === false);
    const dependentCount = dependents.get(lesson.id) ?? 0;

    derived.set(lesson.id, {
      id: lesson.id,
      dependentCount,
      fundamental: dependentCount > 0,
      unblocked: blockedBy.length === 0,
      blockedBy,
    });
  }

  return derived;
}

/**
 * Order the lessons within one module: difficulty ascending, then the plan.
 *
 * A lesson with no difficulty sorts last rather than first. The alternative reads
 * an absent number as a 0, which would put every unrated lesson at the front of
 * the module and make "start with the easiest" mean "start with the ones nobody
 * graded".
 *
 * Ties fall through to the plan's row order, then to the file's sequence, then to
 * the id — so the order is total, and two renders of the same module never
 * disagree.
 */
export function orderModule(lessons: readonly LessonNode[]): readonly LessonNode[] {
  return [...lessons].sort(
    (a, b) =>
      rank(a.difficulty) - rank(b.difficulty) ||
      rank(a.position) - rank(b.position) ||
      rank(a.seq) - rank(b.seq) ||
      // Ids are unique, so this last step only ever decides between two rows the
      // plan left genuinely indistinguishable — and it always decides the same way.
      a.id.localeCompare(b.id),
  );
}

/** Null sorts last, whatever the column. */
function rank(value: number | null): number {
  return value === null ? Number.MAX_SAFE_INTEGER : value;
}

/**
 * How far through a module, as a fraction that means something (FR-P2).
 *
 * The denominator is every lesson the module has — the plan as it now stands,
 * plus anything taught off-plan — which is why it needs no "was this planned?"
 * flag to stay honest. **Null when the module has no lessons at all**: that is
 * "not planned yet", and there is no fraction to draw.
 */
export function moduleProgress(lessons: readonly LessonNode[]): ModuleProgress | null {
  if (lessons.length === 0) return null;

  return {
    completed: lessons.filter((lesson) => lesson.completed).length,
    total: lessons.length,
  };
}

/**
 * The next thing to do: the first unblocked, unfinished lesson (FR-K7).
 *
 * Modules are taken in the order given — the caller owns that, because it comes
 * from `track_edges` and `tracks.position` and not from anything here — and within
 * a module `orderModule` decides.
 *
 * A lesson that is already written but unread is a candidate, and it comes before
 * any planned lesson its module puts after it. Generating a new lesson while an
 * unread one waits is how a curriculum turns into a backlog, and the returned
 * node's `status` is what lets the caller say "read this" rather than "teach this".
 *
 * Lessons in no module are never suggested: "module order" has nothing to say
 * about them, and an off-plan lesson was a deliberate detour rather than the plan
 * asking for something.
 */
export function nextLesson(
  lessons: readonly LessonNode[],
  moduleOrder: readonly string[],
): LessonNode | null {
  const derived = deriveLessons(lessons);

  for (const trackId of moduleOrder) {
    const module = orderModule(lessons.filter((lesson) => lesson.trackId === trackId));

    const candidate = module.find(
      (lesson) => !lesson.completed && derived.get(lesson.id)!.unblocked,
    );
    if (candidate) return candidate;
  }

  return null;
}
