import { describe, expect, it } from "vitest";
import {
  allPrerequisites,
  topologicalOrder,
  unmetPrerequisites,
  wouldCreateCycle,
  type PrereqEdge,
} from "./prerequisites.js";

/** A requires B: `edge("a", "b")`. */
function edge(skillId: string, prereqId: string): PrereqEdge {
  return { skillId, prereqId };
}

describe("allPrerequisites", () => {
  it("finds the direct ones", () => {
    expect([...allPrerequisites([edge("a", "b"), edge("a", "c")], "a")].sort()).toEqual(["b", "c"]);
  });

  it("follows the chain", () => {
    // A→B→C: understanding A needs C, even though nothing says so directly.
    expect([...allPrerequisites([edge("a", "b"), edge("b", "c")], "a")].sort()).toEqual(["b", "c"]);
  });

  it("returns nothing for a skill with no prerequisites", () => {
    expect(allPrerequisites([edge("a", "b")], "b").size).toBe(0);
  });

  it("terminates on a graph that already contains a cycle", () => {
    // Rows written before the constraint existed, or edited by hand. Reading them must not hang.
    const cyclic = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    expect([...allPrerequisites(cyclic, "a")].sort()).toEqual(["a", "b", "c"]);
  });

  it("does not overflow the stack on a long chain", () => {
    // Iterative rather than recursive, because this runs on a graph a user built and nobody bounded.
    const chain = Array.from({ length: 20_000 }, (_, i) => edge(`s${i}`, `s${i + 1}`));
    expect(allPrerequisites(chain, "s0").size).toBe(20_000);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses a skill requiring itself", () => {
    // The degenerate cycle, and the one a user reaches by misclicking.
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("refuses the direct reverse of an existing edge", () => {
    expect(wouldCreateCycle([edge("a", "b")], "b", "a")).toBe(true);
  });

  it("refuses a transitive cycle, which is the case a naive check misses", () => {
    // With A→B and B→C, adding C→A closes the loop even though nothing directly connects C to A.
    // Testing only for the reverse edge would let this through, and a cycle means every skill in it is
    // blocked by itself — nothing left for the ZPD recommendation to suggest.
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("refuses a longer transitive cycle", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "e")];
    expect(wouldCreateCycle(edges, "e", "a")).toBe(true);
  });

  it("allows an edge that merely creates a diamond", () => {
    // A requires B and C; both require D. Not a cycle, and a common shape — refusing it would make the
    // graph a tree, which is not what FR-S1 asks for.
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d")];
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });

  it("allows a second, unrelated prerequisite", () => {
    expect(wouldCreateCycle([edge("a", "b")], "a", "c")).toBe(false);
  });

  it("allows an edge in the same direction as an existing chain", () => {
    // A→B→C, then A→C directly. Redundant, not circular.
    expect(wouldCreateCycle([edge("a", "b"), edge("b", "c")], "a", "c")).toBe(false);
  });
});

describe("unmetPrerequisites", () => {
  it("names the direct prerequisites that are not met", () => {
    const edges = [edge("a", "b"), edge("a", "c")];
    expect(unmetPrerequisites(edges, "a", (id) => id === "b")).toEqual(["c"]);
  });

  it("looks only one level down", () => {
    // "You can't do A until B" is actionable; listing B's own prerequisites too would bury the one
    // thing to work on next under everything that leads to it.
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(unmetPrerequisites(edges, "a", () => false)).toEqual(["b"]);
  });

  it("returns nothing when everything is met", () => {
    expect(unmetPrerequisites([edge("a", "b")], "a", () => true)).toEqual([]);
  });
});

describe("topologicalOrder", () => {
  it("puts a prerequisite before what needs it", () => {
    const order = topologicalOrder(["a", "b"], [edge("a", "b")]);
    expect(order).toEqual(["b", "a"]);
  });

  it("orders a chain from the bottom up", () => {
    const order = topologicalOrder(["a", "b", "c"], [edge("a", "b"), edge("b", "c")]);
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("includes skills with no edges at all", () => {
    // A brand new skill has no prerequisites and must still appear, or adding one would make it vanish
    // from the list.
    const order = topologicalOrder(["a", "b", "loose"], [edge("a", "b")]);
    expect(order).toHaveLength(3);
    expect(order).toContain("loose");
  });

  it("orders a diamond consistently", () => {
    const order = topologicalOrder(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    )!;

    expect(order.indexOf("d")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("says a cyclic graph cannot be ordered, rather than returning a partial list", () => {
    // A partial order would silently omit skills, and the caller needs to be able to *say* the stored
    // graph is broken — which is reachable through a hand-edited row.
    expect(
      topologicalOrder(["a", "b", "c"], [edge("a", "b"), edge("b", "c"), edge("c", "a")]),
    ).toBeNull();
  });

  it("ignores an edge to a skill outside the set", () => {
    // Filtered by band, say. The caller asked to order these, and a prerequisite it did not pass in is
    // not one of them — inventing it would put an id in the list that has no skill.
    const order = topologicalOrder(["a"], [edge("a", "elsewhere")]);
    expect(order).toEqual(["a"]);
  });

  it("returns every skill exactly once when an edge is duplicated", () => {
    // The database's primary key on (skill_id, prereq_id) prevents this, but the function takes a plain
    // array — a caller concatenating two queries can hand it the same edge twice, and the skill must
    // not appear twice in the order.
    const order = topologicalOrder(["a", "b"], [edge("a", "b"), edge("a", "b")])!;
    expect(order).toEqual(["b", "a"]);
  });

  it("returns every skill exactly once", () => {
    const order = topologicalOrder(
      ["a", "b", "c", "d"],
      [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    )!;
    expect(new Set(order).size).toBe(4);
  });

  it("does not overflow the stack on a long chain", () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => `s${i}`);
    const chain = ids.slice(0, -1).map((id, i) => edge(id, `s${i + 1}`));

    const order = topologicalOrder(ids, chain)!;
    expect(order).toHaveLength(10_000);
    expect(order[0]).toBe("s9999");
  });
});
