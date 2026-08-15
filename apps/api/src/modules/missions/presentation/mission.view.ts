import type { MissionView } from "@mindforge/core";
import type { Mission } from "../domain/mission.js";

export type { MissionView };

/**
 * What a mission looks like on the wire.
 *
 * A separate shape from the entity, not out of ceremony but because the two answer
 * to different things: the entity answers to the product's rules, and this answers
 * to a client that will be versioned. `status` is a key — the SPA translates it
 * (§5.2) — and timestamps are ISO 8601 UTC, with the user's timezone applied at
 * render rather than baked in here.
 *
 * **The shape itself is `MissionViewSchema` in `packages/core`.** It used to be
 * declared here and again in the SPA's `use-missions.ts`, linked by a comment;
 * now both ends derive from one schema and the SPA parses against it, so dropping
 * a field here stops compiling instead of arriving as `undefined` on a card.
 */
export function toMissionView(mission: Mission): MissionView {
  const snapshot = mission.toSnapshot();
  return {
    id: snapshot.id,
    topic: snapshot.topic,
    why: snapshot.why,
    successLooksLike: snapshot.successLooksLike,
    constraints: snapshot.constraints,
    currentLevel: snapshot.currentLevel,
    status: snapshot.status,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
  // userId is deliberately absent: the caller is the owner by construction, so
  // returning it would be noise the client could start keying off.
}
