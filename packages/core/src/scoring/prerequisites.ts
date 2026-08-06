/**
 * The prerequisite graph (FR-S1) — a DAG, not a flat list.
 *
 * "You can't do X until Y" is the point, and it is also what makes a cycle catastrophic rather than
 * untidy: a cycle means every skill in it is blocked by itself, so the ZPD recommendation has nothing
 * to suggest and the UI has no order to render. There is no honest way to display one, which is why
 * this is prevented at write time rather than tolerated at read time.
 *
 * Pure functions over plain edges, because the same rules apply in the API (which enforces them) and
 * the SPA (which greys out the options that would break them) — and a client that let you pick an
 * edge the server will reject is a client that wastes a round trip to say no.
 */

export interface PrereqEdge {
  /** The skill that has the prerequisite. */
  readonly skillId: string;
  /** What must come first. */
  readonly prereqId: string;
}

/** Adjacency from a skill to the things it requires. */
function requirements(edges: readonly PrereqEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = map.get(edge.skillId);
    if (existing) existing.push(edge.prereqId);
    else map.set(edge.skillId, [edge.prereqId]);
  }
  return map;
}

/**
 * Everything a skill depends on, directly or transitively.
 *
 * Iterative rather than recursive: a deep chain in a user-built graph would blow the stack, and this
 * runs on input nobody validated the shape of.
 */
export function allPrerequisites(edges: readonly PrereqEdge[], skillId: string): Set<string> {
  const map = requirements(edges);
  const seen = new Set<string>();
  const stack = [...(map.get(skillId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(map.get(current) ?? []));
  }

  return seen;
}

/**
 * Whether adding `skillId requires prereqId` would close a loop.
 *
 * The transitive case is the one that matters and the one a naive check misses: with A→B and B→C
 * already there, adding C→A is a cycle even though nothing directly connects C to A. Testing only for
 * the reverse edge would let it through.
 */
export function wouldCreateCycle(
  edges: readonly PrereqEdge[],
  skillId: string,
  prereqId: string,
): boolean {
  // A skill requiring itself is the degenerate cycle, and the one a user reaches by misclicking.
  if (skillId === prereqId) return true;
  // If the proposed prerequisite already depends on this skill, the new edge closes the loop.
  return allPrerequisites(edges, prereqId).has(skillId);
}

/** Which of a skill's prerequisites are not yet at the level a caller considers sufficient. */
export function unmetPrerequisites(
  edges: readonly PrereqEdge[],
  skillId: string,
  isMet: (prereqId: string) => boolean,
): string[] {
  return (requirements(edges).get(skillId) ?? []).filter((prereqId) => !isMet(prereqId));
}

/**
 * A dependency-first order: everything appears after what it requires.
 *
 * Returns null when the graph has a cycle rather than a partial order or a throw. A caller reading a
 * stored graph needs to be able to *say* it is broken — data written before a constraint existed, or
 * edited by hand, and a partial list would silently omit skills.
 */
export function topologicalOrder(
  skillIds: readonly string[],
  edges: readonly PrereqEdge[],
): string[] | null {
  const map = requirements(edges);
  const known = new Set(skillIds);
  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];

  // Iterative depth-first with an explicit stack, for the same stack-depth reason as above.
  for (const root of skillIds) {
    if (state.get(root) === "done") continue;

    const stack: { id: string; expanded: boolean }[] = [{ id: root, expanded: false }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;

      if (frame.expanded) {
        stack.pop();
        state.set(frame.id, "done");
        order.push(frame.id);
        continue;
      }

      if (state.get(frame.id) === "done") {
        stack.pop();
        continue;
      }
      if (state.get(frame.id) === "visiting") return null;

      state.set(frame.id, "visiting");
      frame.expanded = true;

      for (const prereqId of map.get(frame.id) ?? []) {
        // An edge to a skill outside the given set is skipped rather than invented: the caller asked
        // to order these, and a prerequisite it did not pass in is not one of them.
        if (!known.has(prereqId)) continue;
        if (state.get(prereqId) !== "done") stack.push({ id: prereqId, expanded: false });
      }
    }
  }

  return order;
}
