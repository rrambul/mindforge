/**
 * `BRIEFING.md` — the ZPD bridge (FR-T7), and the file where being honest is
 * load-bearing rather than principled.
 *
 * The briefing is read by a model that will treat a number as evidence and teach
 * from it. Non-negotiable 1 — "unknown is never rendered as zero" — matters
 * differently here than on a screen: a human squints at a suspicious 0%, and a
 * model plans a lesson around it. A fabricated "0 items due" produces teaching
 * that skips revision on the strength of a measurement nobody made.
 *
 * **So the absences are enforced by the type, not by discipline.** Every signal
 * that has no source table until M4, M5 or M6 is a `NotTracked`, which holds a
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

export interface SelfReportedSkill {
  readonly name: string;
  /** `perceived_level` — the learner's own estimate, never a measured score. */
  readonly perceivedLevel: string | null;
}

export interface FrictionSummary {
  readonly kind: string;
  readonly occurrences: number;
}

export interface BriefingInput {
  readonly missionTopic: string | null;
  readonly lessonCount: number;
  readonly recordCount: number;

  /** Records' `## Next` sections. The only real ZPD input in M3. */
  readonly zpdCandidates: readonly ZpdCandidate[];

  /** Self-reported only, and labelled as such. Measured evidence is M4/M6. */
  readonly skills: readonly SelfReportedSkill[];

  /** Real since M1 — the one genuinely measured signal the briefing carries. */
  readonly recentFriction: readonly FrictionSummary[];
  readonly frictionWindowDays: number;

  /**
   * Each of these is a `NotTracked` for the whole of M3, and the type is what
   * keeps them that way. Turning one into a number means deleting its
   * `NotTracked` from this union, which is a visible change.
   */
  readonly dueReviews: Tracked<readonly string[]>;
  readonly skillEvidence: Tracked<readonly string[]>;
  readonly reviewAccuracy: Tracked<number>;
  readonly lessonOutcomes: Tracked<readonly string[]>;
}

/**
 * The absences M3 ships with, in one place so a caller cannot phrase them
 * differently and so the day one becomes real is a deletion here.
 */
export const M3_ABSENCES = {
  dueReviews: notTracked(
    "Spaced repetition ships in a later release, so nothing schedules reviews yet. " +
      "Do not assume the learner has or has not revised anything — this is unmeasured, not zero.",
  ),
  skillEvidence: notTracked(
    "No measured skill evidence exists yet: lesson outcomes and assessments both arrive later. " +
      "Any levels listed below are the learner's own estimate, not a score.",
  ),
  reviewAccuracy: notTracked("Unmeasured. There is no review history to compute accuracy from."),
  lessonOutcomes: notTracked(
    "The in-app reader is not shipped, so no completion or understood/shaky/lost signal exists. " +
      "Past lessons may or may not have been read.",
  ),
} as const satisfies Pick<
  BriefingInput,
  "dueReviews" | "skillEvidence" | "reviewAccuracy" | "lessonOutcomes"
>;

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body.trim()}\n`;
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

  parts.push(
    section(
      "What to teach next",
      input.zpdCandidates.length === 0
        ? "No learning records yet, so there is nothing to derive a zone of proximal development " +
            "from. Start from the mission and the learner's stated current level."
        : [
            "From learning records' `Next` sections **only**. Skill-graph gaps and due reviews are",
            "not yet available as inputs, so treat this as a starting point rather than as a",
            "complete picture of the learner's frontier.",
            "",
            list(input.zpdCandidates.map((c) => `${c.next}  _(${c.fromRecord})_`)),
          ].join("\n"),
    ),
  );

  parts.push(
    section(
      "Skills",
      isNotTracked(input.skillEvidence)
        ? [
            input.skillEvidence.reason,
            "",
            input.skills.length === 0
              ? "_The learner has not rated any skills._"
              : list(
                  input.skills.map(
                    (skill) => `${skill.name} — self-rated: ${skill.perceivedLevel ?? "not rated"}`,
                  ),
                ),
          ].join("\n")
        : list(input.skillEvidence),
    ),
  );

  parts.push(
    section(
      "Due reviews",
      isNotTracked(input.dueReviews) ? input.dueReviews.reason : list(input.dueReviews),
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
      "Recent friction",
      input.recentFriction.length === 0
        ? `No friction logged in the last ${input.frictionWindowDays} days.`
        : [
            `Logged by the learner in the last ${input.frictionWindowDays} days. This is measured,`,
            "unlike most of the above — it is worth designing around.",
            "",
            list(
              input.recentFriction.map((friction) => `${friction.kind} — ${friction.occurrences}×`),
            ),
          ].join("\n"),
    ),
  );

  parts.push(
    section(
      "A note on what is missing",
      [
        "Several sections above say a signal is **not tracked yet**. That is a statement about",
        "Mindforge, not about the learner.",
        "",
        'Do not reason as if an untracked signal were an empty one. "No reviews due" and "reviews',
        'are not tracked" are different facts, and teaching as though the learner has revised',
        "nothing — or everything — is a guess dressed as evidence.",
      ].join("\n"),
    ),
  );

  return `${parts.join("\n")}`;
}
