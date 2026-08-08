import type { Profile, SettingsPatch } from "./profile.js";

export const PROFILE_REPOSITORY = Symbol("ProfileRepository");

/**
 * `profiles` is keyed on `id`, not `user_id` — the row *is* the user, and its policy is
 * `id = auth.uid()`. So every method here takes the id it is about, exactly like the rest of the
 * repositories, and there is no separate scoping column to forget.
 */
export interface ProfileRepository {
  find(userId: string): Promise<Profile | null>;

  /**
   * Writes only the columns the patch names, and returns the row as it now stands.
   *
   * A partial UPDATE rather than load-modify-save, because those would be two round trips with a
   * gap in between: a second tab that changed the theme inside that gap would have its change
   * reverted by this one. That is precisely the failure `UpdateProfileSchema` refuses to build into
   * the wire format ("there is no PUT"), and reintroducing it one layer down would make the schema's
   * care pointless.
   *
   * Null when there is no such profile — see the note in `ProfileNotFound`.
   */
  updateSettings(userId: string, patch: SettingsPatch): Promise<Profile | null>;

  /**
   * §14.1. Its own method rather than a field on the patch, even though it writes the same row:
   * opening the changelog is a side effect of looking at a screen, and one shared write path would
   * let a theme change clear the unseen dot.
   */
  markChangelogSeen(userId: string, version: string): Promise<Profile | null>;
}
