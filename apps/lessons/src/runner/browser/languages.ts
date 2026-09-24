import { EXERCISE_LANGUAGES, type ExerciseLanguage } from "@mindforge/core";

/**
 * Which languages a runner page may run (TECH-DESIGN.md §7.5).
 *
 * There are two runner pages because there are two CSPs. JavaScript and
 * TypeScript need nothing from the network, so their page keeps `connect-src
 * 'none'`; Python has to fetch its interpreter, so only its page has `'self'`. The
 * page says which languages it is for in a `<meta>`, and the client refuses the
 * rest — so a run can never land under the looser policy by being sent to the
 * wrong frame.
 *
 * Plain data and a pure function, shared by the handler (which writes the tag) and
 * the client (which reads it), so the two cannot disagree about the spelling.
 */

export const LANGUAGES_META = "mindforge:languages";

export type RunnerPage = "javascript" | "python";

export const PAGE_LANGUAGES: Readonly<Record<RunnerPage, readonly ExerciseLanguage[]>> = {
  javascript: ["javascript", "typescript"],
  python: ["python"],
};

/** The tag's content → the languages it allows. Unknown words allow nothing; a missing tag allows nothing. */
export function allowedLanguages(
  content: string | null | undefined,
): ReadonlySet<ExerciseLanguage> {
  const known = new Set<string>(EXERCISE_LANGUAGES);
  return new Set(
    (content ?? "").split(/\s+/u).filter((word): word is ExerciseLanguage => known.has(word)),
  );
}
