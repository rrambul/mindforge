export const LINK_TARGETS = Symbol("LinkTargets");

/**
 * Whether a thing a resource is being linked to is really there.
 *
 * Deliberately a near-copy of the goals module's `SubjectExistenceReader`, rather than a shared one.
 * The two modules answer the same question about different sets of subjects, and the alternative —
 * one module importing the other's port — is the cross-module dependency the layering exists to keep
 * out. Twenty lines is a cheaper price than that coupling.
 *
 * Checked rather than left to the foreign key: a constraint violation arrives from the driver as an
 * opaque error and becomes a 500, while "that mission no longer exists" is an ordinary thing to tell a
 * client — and it is reachable just by having two tabs open.
 */
export interface LinkTargetReader {
  exists(userId: string, kind: "mission" | "skill", id: string): Promise<boolean>;
}
