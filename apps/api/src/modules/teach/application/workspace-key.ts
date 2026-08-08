import { slugify } from "@mindforge/workspace";

/**
 * Deriving a mission's Storage prefix, once.
 *
 * `missions.workspace_key` has existed since M0 carrying a comment that says it
 * is set once so renaming a mission cannot move files — and nothing has ever
 * written it. M3 is where that happens, so this is where the rule becomes real
 * rather than aspirational.
 *
 * **Set once, never recomputed.** A mission's topic is free to change; §7's own
 * open item 7 calls this out, and the reason is that the key is a path. Recompute
 * it on a rename and the next run materialises an empty prefix, writes a fresh
 * lesson 0001 into it, and the learner's history is still in Storage under a name
 * nothing points at any more.
 */

/** Long enough to stay readable in a Storage console, short enough for a path. */
const MAX_LENGTH = 48;

/**
 * A slug for `workspaces/<user_id>/<key>/`, or `null` if the topic yields none.
 *
 * Uniqueness is per user, enforced by `missions_user_id_workspace_key_key`, so
 * the disambiguating suffix only has to distinguish one person's missions from
 * each other. That is also why it is not a global counter: two users teaching
 * themselves Rust both get `rust`, and neither learns that the other exists.
 */
export function deriveWorkspaceKey(topic: string, taken: readonly string[]): string | null {
  const base = slugify(topic).slice(0, MAX_LENGTH).replace(/-+$/u, "");
  if (base === "") return null;

  const used = new Set(taken);
  if (!used.has(base)) return base;

  // `rust-2`, `rust-3`. Bounded rather than a `while (true)`: a user with fifty
  // missions on one topic has a different problem, and an unbounded loop against
  // a set somebody else controls is a hang waiting to happen.
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base.slice(0, MAX_LENGTH - 3)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  return null;
}
