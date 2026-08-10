/**
 * What every parser in this package returns.
 *
 * The `teach` skill's formats are a contract Mindforge does not control — the
 * skill is upstream, the files are written by a model, and both will drift. So
 * the rule from TECH-DESIGN.md §7.4 is absolute: **a format change degrades to
 * "file stored, partially indexed", never "run failed" and never "content
 * lost".** Nothing here throws. The only thing that may throw is I/O, and I/O
 * does not live in this package.
 *
 * That makes `warnings` the interesting half of the return value rather than an
 * afterthought. A run that indexed nothing and warned about everything is a
 * recoverable afternoon; a run that failed on the first unexpected heading has
 * thrown away a lesson the model spent ten minutes writing.
 */

/**
 * Warning codes are **stable machine keys**, never prose.
 *
 * §5.2: enum values are keys and the UI translates at render. A warning that
 * surfaces on a run's result screen has to render in pt-BR too, and English
 * baked into a jsonb column cannot.
 */
export type WarningCode =
  // Structure
  | "section_missing"
  | "section_empty"
  | "section_placeholder"
  | "section_unknown"
  | "heading_duplicated"
  // Values
  | "value_unknown"
  | "value_coerced"
  | "value_malformed"
  | "value_duplicated"
  // Graphs
  | "edge_cycle"
  // Files
  | "filename_unnumbered"
  | "filename_slug_normalized"
  | "sequence_mismatch"
  // Documents
  | "title_missing"
  | "title_ambiguous"
  | "link_unresolved";

export interface ParseWarning {
  readonly code: WarningCode;
  /**
   * ICU arguments for the message, never rendered text. Which section, which
   * column, which value — the things a translation needs to name.
   */
  readonly args?: Readonly<Record<string, string | number>>;
}

export interface Parsed<T> {
  readonly parsed: T;
  readonly warnings: readonly ParseWarning[];
  /**
   * Content the format contained and Mindforge has nowhere to put.
   *
   * Retained rather than dropped, because "we have no table for this" is a fact
   * about Mindforge and not about the file. `RESOURCES.md`'s `## Communities`
   * section is the standing example: the skill treats communities as one of its
   * three pillars, and there is no communities table until M6 at the earliest.
   * Dropping it silently would make the workspace round-trip lossy, and
   * non-negotiable 5 says files are canonical.
   */
  readonly unmapped: Readonly<Record<string, string>>;
}

export function warn(
  code: WarningCode,
  args?: Readonly<Record<string, string | number>>,
): ParseWarning {
  return args ? { code, args } : { code };
}
