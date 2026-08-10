/**
 * `BRIEFING.md` — what the agent knows before it teaches (FR-T3), and the file
 * where being honest is load-bearing rather than principled.
 *
 * The briefing is read by a model that will treat a number as evidence and teach
 * from it. Non-negotiable 1 — "unknown is never rendered as zero" — matters
 * differently here than on a screen: a human squints at a suspicious 0%, and a
 * model plans a lesson around it. A fabricated "no lessons completed" produces
 * teaching that repeats ground on the strength of a measurement nobody made.
 *
 * **So the absences are enforced by the type, not by discipline.** Every signal
 * that has no source until a later milestone is a `NotTracked`, which holds a
 * reason and cannot hold a number. `renderBriefing` has no branch that could
 * print a zero for one, because there is no zero to print — a later edit that
 * wanted to would have to change this file's types first, which is a decision
 * rather than an accident.
 *
 * Regenerated every run and excluded from sync-back (§7.4). It is an input, and
 * `skills/UNATTENDED.md` tells the agent so, because `SKILL.md`'s own workspace
 * inventory predates it and an agent tidying to that inventory would delete it.
 */

/**
 * A signal Mindforge cannot measure yet.
 *
 * `reason` is prose for the model rather than a key for the UI: nothing renders
 * this in a browser, and the agent needs the sentence, not a translation.
 */
export interface NotTracked {
  readonly status: "not-tracked";
  /** What is missing and what the agent must not infer from its absence. */
  readonly reason: string;
}

export type Tracked<T> = T | NotTracked;

export function notTracked(reason: string): NotTracked {
  return { status: "not-tracked", reason };
}

function isNotTracked(value: unknown): value is NotTracked {
  return typeof value === "object" && value !== null && "status" in value;
}

export interface ZpdCandidate {
  /** The record's `## Next`, verbatim. */
  readonly next: string;
  /** Which record it came from, so the agent can read the whole thing. */
  readonly fromRecord: string;
}

/** One lesson already written into the open module, so the agent does not repeat it. */
export interface TrackLesson {
  readonly seq: number;
  readonly title: string;
}

/**
 * The module this run is teaching within.
 *
 * Lessons are generated one at a time, on demand — the learner finishes one and
 * asks for the next — so a run's job is not "teach the next thing in this
 * mission" but "teach the next thing in **this track**". The boundary is what
 * makes a module cohere; the skill's own ZPD logic still decides what inside it.
 */
export interface CurrentTrack {
  readonly slug: string;
  readonly name: string;
  readonly outcome: string | null;
  /** Where the curriculum put it. A reading order, not a claim about readiness. */
  readonly position: number;
  readonly totalTracks: number;
  /** Track names this one is built on, so the agent can assume that ground. */
  readonly prerequisites: readonly string[];
  /** Already written, in order. The agent reads these before adding to them. */
  readonly lessons: readonly TrackLesson[];
}

export interface BriefingInput {
  readonly missionTopic: string | null;
  readonly lessonCount: number;
  readonly recordCount: number;

  /**
   * Null in two different situations the agent must not confuse, which is why
   * this is a union rather than a nullable object: the mission may have no
   * curriculum at all, or it may have one with no module open.
   */
  readonly currentTrack: Tracked<CurrentTrack>;

  /** Records' `## Next` sections. The only real what-next input until lessons render in-app. */
  readonly zpdCandidates: readonly ZpdCandidate[];

  /**
   * `NotTracked` until the in-app reader ships (M5), and the type is what
   * keeps it that way. Turning it into data means deleting its `NotTracked`
   * from this union, which is a visible change.
   */
  readonly lessonOutcomes: Tracked<readonly string[]>;
}

/**
 * The two reasons a run has no module, phrased so the agent does the right and
 * different thing in each.
 *
 * Kept beside `BRIEFING_ABSENCES` because they are the same kind of statement:
 * a fact about Mindforge that the agent must not read as a fact about the
 * learner.
 */
export const NO_TRACK = {
  noCurriculum: notTracked(
    "This mission has no CURRICULUM.md yet, so it has no subtopics and no modules. " +
      "Teach from the mission itself, and do not invent a curriculum or write one — " +
      "structure is produced by a separate skill, deliberately, so it can be revised " +
      "without discarding lessons.",
  ),
  noneOpen: notTracked(
    "This mission has a curriculum, but no module is currently open. Teach the most " +
      "defensible next thing from the mission and the records below, and leave the " +
      "lesson's `mindforge:track` meta tag off rather than guessing at one — a lesson " +
      "filed under the wrong module is worse than one filed under none.",
  ),
} as const;

/**
 * The absences this release ships with, in one place so a caller cannot phrase
 * them differently and so the day one becomes real is a deletion here.
 */
export const BRIEFING_ABSENCES = {
  lessonOutcomes: notTracked(
    "The in-app reader is not shipped, so no completion or understood/shaky/lost signal exists. " +
      "Past lessons may or may not have been read.",
  ),
} as const satisfies Pick<BriefingInput, "lessonOutcomes">;

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body.trim()}\n`;
}

/**
 * The open module, and the instruction that comes with it.
 *
 * The instruction is here rather than in `SKILL.md` because it is per-run state:
 * which track is open changes between runs, and the skill is a fixed document
 * vendored verbatim from upstream. `skills/UNATTENDED.md` carries the standing
 * half of the rule; this carries the part that is only true today.
 */
function renderTrack(track: Tracked<CurrentTrack>): string {
  if (isNotTracked(track)) return track.reason;

  const lines = [
    `**${track.name}** — subtopic ${track.position} of ${track.totalTracks} in this mission's curriculum.`,
    "",
    track.outcome === null
      ? "The curriculum did not record an outcome for this module."
      : `What the learner should be able to do afterwards: ${track.outcome}`,
    "",
    "**Teach the next thing inside this module, not the next thing in the mission.**",
    "Write exactly one lesson and stop — the learner asks for the next one when they have",
    "done this one, and a run that writes four has guessed at three of them without seeing",
    "how the first landed.",
    "",
    "Declare the module in the lesson's `<head>`:",
    "",
    "```html",
    `<meta name="mindforge:track" content="${track.slug}">`,
    "```",
    "",
    "Without it the lesson is filed under no module.",
  ];

  if (track.prerequisites.length > 0) {
    lines.push(
      "",
      `Built on: ${track.prerequisites.join(", ")}. The learner has worked through those modules —`,
      "which is not the same as having proved anything, and nothing below measures it yet.",
    );
  }

  lines.push(
    "",
    "### Lessons already in this module",
    "",
    track.lessons.length === 0
      ? "_None yet — this is the module's first lesson._"
      : list(
          track.lessons.map((lesson) => `${String(lesson.seq).padStart(4, "0")} — ${lesson.title}`),
        ),
  );

  return lines.join("\n");
}

function list(items: readonly string[]): string {
  return items.length === 0 ? "_None._" : items.map((item) => `- ${item}`).join("\n");
}

/**
 * Render the briefing.
 *
 * Pure, and takes a plain object rather than a repository, so the wording is
 * pinned by a snapshot test rather than by whatever the database happened to hold.
 */
export function renderBriefing(input: BriefingInput): string {
  const parts: string[] = [
    `# Briefing`,
    "",
    "Generated fresh for this run by Mindforge. Read it before anything else.",
    "",
    "This file is an input. It is regenerated every run and never saved back, so edits to it are",
    "lost — write your own notes to `NOTES.md` instead.",
    "",
  ];

  parts.push(
    section(
      "Where this mission stands",
      [
        input.missionTopic === null
          ? "`MISSION.md` has no topic filled in yet. Work from what is below and teach anyway — " +
            "there is nobody to ask, and a run that ends without a lesson is a failed run."
          : `Topic: ${input.missionTopic}`,
        "",
        `Lessons written so far: ${input.lessonCount}`,
        `Learning records: ${input.recordCount}`,
      ].join("\n"),
    ),
  );

  parts.push(section("The module you are teaching in", renderTrack(input.currentTrack)));

  parts.push(
    section(
      "What to teach next",
      input.zpdCandidates.length === 0
        ? "No learning records yet, so there is nothing to derive a zone of proximal development " +
            "from. Start from the mission and the learner's stated current level."
        : [
            "From learning records' `Next` sections **only**. Treat this as a starting point",
            "rather than as a complete picture of the learner's frontier.",
            "",
            list(input.zpdCandidates.map((c) => `${c.next}  _(${c.fromRecord})_`)),
          ].join("\n"),
    ),
  );

  parts.push(
    section(
      "Past lesson outcomes",
      isNotTracked(input.lessonOutcomes) ? input.lessonOutcomes.reason : list(input.lessonOutcomes),
    ),
  );

  parts.push(
    section(
      "A note on what is missing",
      [
        "A section above may say a signal is **not tracked yet**. That is a statement about",
        "Mindforge, not about the learner.",
        "",
        "Do not reason as if an untracked signal were an empty one. Teaching as though the",
        "learner has completed nothing — or everything — is a guess dressed as evidence.",
      ].join("\n"),
    ),
  );

  return `${parts.join("\n")}`;
}
