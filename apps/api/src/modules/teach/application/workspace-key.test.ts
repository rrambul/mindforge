import { describe, expect, it } from "vitest";

import { deriveWorkspaceKey } from "./workspace-key.js";

/**
 * The Storage prefix, which is a path and therefore permanent.
 *
 * Everything here is about the consequence of getting it wrong once: the key is
 * set at first materialisation and never recomputed (§16.7), so a bad one is a
 * directory a learner's history lives in for as long as the mission does.
 */

describe("deriveWorkspaceKey", () => {
  it("slugifies the topic", () => {
    expect(deriveWorkspaceKey("Postgres row-level security", [])).toBe(
      "postgres-row-level-security",
    );
  });

  it("strips accents rather than dropping the characters", () => {
    // The agent writes in the learner's content language (FR-L3), and Portuguese
    // is a first-class option — so a mission called "Programação" must produce a
    // path, not an empty string.
    expect(deriveWorkspaceKey("Programação funcional", [])).toBe("programacao-funcional");
  });

  it("caps the length, because this is a path segment", () => {
    const key = deriveWorkspaceKey("a".repeat(200), []);
    expect(key!.length).toBeLessThanOrEqual(48);
  });

  it("never ends in a separator after truncation", () => {
    // `rust-` would produce `workspaces/<uid>/rust-/…`, which is legal and looks
    // like a mistake in every console anyone ever opens.
    const key = deriveWorkspaceKey(`${"ab ".repeat(30)}`, []);
    expect(key!.endsWith("-")).toBe(false);
  });

  it("disambiguates against keys the user already holds", () => {
    expect(deriveWorkspaceKey("Rust", ["rust"])).toBe("rust-2");
    expect(deriveWorkspaceKey("Rust", ["rust", "rust-2"])).toBe("rust-3");
  });

  it("only considers this user's keys", () => {
    // Uniqueness is per user — the path is already scoped by user id. Two people
    // teaching themselves Rust both get `rust`, and neither learns the other
    // exists. That was not true before M3, when the column was globally unique.
    expect(deriveWorkspaceKey("Rust", [])).toBe("rust");
  });

  it("keeps a disambiguated key inside the cap", () => {
    const long = "b".repeat(60);
    const key = deriveWorkspaceKey(long, [long.slice(0, 48)]);
    expect(key!.length).toBeLessThanOrEqual(48);
    expect(key).toMatch(/-2$/u);
  });

  it("returns null when the topic yields no slug at all", () => {
    // The caller turns this into a 422 rather than writing an empty prefix — which
    // would be `workspaces/<uid>/`, every other unnamed mission's prefix too, so
    // two missions would share one workspace and overwrite each other's lessons.
    expect(deriveWorkspaceKey("!!!", [])).toBeNull();
    expect(deriveWorkspaceKey("   ", [])).toBeNull();
    expect(deriveWorkspaceKey("", [])).toBeNull();
  });

  it("gives up rather than looping forever when every suffix is taken", () => {
    // An unbounded search against a set somebody else controls is a hang waiting
    // to happen, and fifty missions on one topic is a different problem.
    const taken = ["rust", ...Array.from({ length: 60 }, (_, i) => `rust-${i + 2}`)];
    expect(deriveWorkspaceKey("Rust", taken)).toBeNull();
  });
});
