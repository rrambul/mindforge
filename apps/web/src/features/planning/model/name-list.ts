/**
 * A handful of names, read out as a sentence.
 *
 * `names.join(", ")` is the obvious version and it is wrong in both locales the app ships: English
 * wants "Rust, Python and Go" and pt-BR wants "Rust, Python e Go", and neither of them wants the
 * separator the other uses. CLAUDE.md's rule — format with `Intl`, never by hand — covers lists as
 * much as it covers durations, and this is the one place in the slice that joins strings.
 *
 * Local to `planning` rather than in `shared/lib/format.ts`: the review's "not carried over" sentence
 * is the only caller in the app, and §2.2 rule 7's test is whether a second feature needs it. Promote
 * it the day one does.
 *
 * The formatter is cached for the same reason `shared/lib/format.ts` caches its own: constructing an
 * `Intl` object is the expensive part, and this renders inside a list.
 */

const formatters = new Map<string, Intl.ListFormat>();

export function formatNameList(names: readonly string[], locale: string): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    formatters.set(locale, formatter);
  }
  return formatter.format(names);
}
