import { describe, expect, it } from "vitest";
import { matchActions, type Action } from "./action-registry.js";

function action(overrides: Partial<Action> & { label: string }): Action {
  return {
    id: overrides.label.toLowerCase().replace(/\s+/g, "-"),
    group: "Capture",
    run: () => {},
    ...overrides,
  };
}

const ACTIONS: Action[] = [
  action({ label: "Start focus", keywords: ["timer", "begin"] }),
  action({ label: "Stop focus" }),
  action({ label: "Log friction: Tooling", keywords: ["annoyed", "broken"] }),
  action({ label: "Notes", group: "Go to" }),
];

describe("matchActions", () => {
  it("returns everything for an empty query", () => {
    expect(matchActions(ACTIONS, "")).toHaveLength(4);
    expect(matchActions(ACTIONS, "   ")).toHaveLength(4);
  });

  it("puts a prefix match first", () => {
    // The palette's value is that the first result is predictable enough to hit Enter without reading.
    expect(matchActions(ACTIONS, "sta")[0]?.label).toBe("Start focus");
    expect(matchActions(ACTIONS, "sto")[0]?.label).toBe("Stop focus");
  });

  it("matches the start of any word, which is how people search a palette", () => {
    // "focus" should find "Start focus" — nobody types the first word of a label they are looking for.
    expect(matchActions(ACTIONS, "focus").map((a) => a.label)).toContain("Start focus");
  });

  it("ranks a label match above a keyword match", () => {
    // Otherwise typing "to" could put "Log friction: Tooling" above "Stop focus" on the strength of a
    // keyword nobody saw.
    const results = matchActions(ACTIONS, "tooling");
    expect(results[0]?.label).toBe("Log friction: Tooling");
  });

  it("finds an action by a word that is not in its label", () => {
    // Someone reaching for the friction log is more likely to type "annoyed" than the app's vocabulary.
    expect(matchActions(ACTIONS, "annoyed").map((a) => a.label)).toEqual(["Log friction: Tooling"]);
  });

  it("returns nothing for a query nothing matches", () => {
    // Rather than everything, which would look like the filter had failed open.
    expect(matchActions(ACTIONS, "kubernetes")).toEqual([]);
  });

  it("ignores case and surrounding space", () => {
    expect(matchActions(ACTIONS, "  START ")[0]?.label).toBe("Start focus");
  });

  describe("unavailable actions", () => {
    const withUnavailable: Action[] = [
      action({ label: "Stop focus", unavailableReason: "Nothing running" }),
      action({ label: "Start focus" }),
    ];

    it("sorts them last rather than dropping them", () => {
      // An action that vanishes teaches that the palette is unreliable, and the user retypes it looking
      // for a typo. Last, because they are worth showing and not worth showing first.
      const results = matchActions(withUnavailable, "focus");
      expect(results.map((a) => a.label)).toEqual(["Start focus", "Stop focus"]);
    });

    it("still finds one searched for by name", () => {
      // Someone typing "stop" wants to know *why* they cannot, not to be told nothing matches.
      expect(matchActions(withUnavailable, "stop").map((a) => a.label)).toEqual(["Stop focus"]);
    });

    it("keeps them last with an empty query too", () => {
      expect(matchActions(withUnavailable, "")[0]?.label).toBe("Start focus");
    });
  });

  it("does not mutate the list it was given", () => {
    // It sorts, and sorting in place would reorder the registry the app layer built.
    const original = [...ACTIONS];
    matchActions(ACTIONS, "");
    expect(ACTIONS).toEqual(original);
  });
});
