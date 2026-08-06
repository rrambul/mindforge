export const ATTRIBUTION_TARGETS = Symbol("AttributionTargets");

/**
 * Whether the skill or resource a friction event is being attributed to is really there.
 *
 * A near-copy of the resources module's `LinkTargetReader`, for the same reason it is a copy there: one
 * module importing another's port is the cross-module dependency the layering keeps out, and twenty
 * lines is cheaper than that coupling.
 */
export interface AttributionTargetReader {
  exists(userId: string, kind: "skill" | "resource", id: string): Promise<boolean>;
}
