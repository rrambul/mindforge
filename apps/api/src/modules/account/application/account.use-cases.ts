import type { SeenChangelogInput, UpdateProfileInput } from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { ProfileNotFound } from "../domain/errors.js";
import type { Profile, SettingsPatch } from "../domain/profile.js";
import { PROFILE_REPOSITORY, type ProfileRepository } from "../domain/profile.repository.js";

@Injectable()
export class ReadProfile {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string): Promise<Profile> {
    const profile = await this.profiles.find(userId);
    if (!profile) throw new ProfileNotFound(userId);
    return profile;
  }
}

/**
 * The write path M2 cannot ship without.
 *
 * Until this existed the signup trigger inserted nothing but the id, so every real account sat at
 * `timezone: 'UTC'` and `weekStartsOn: 1` with no way out — and "the nightly rollup runs per user
 * timezone" was a sentence about a column nobody could set.
 */
@Injectable()
export class UpdateSettings {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string, input: UpdateProfileInput): Promise<Profile> {
    const updated = await this.profiles.updateSettings(userId, toPatch(input));
    if (!updated) throw new ProfileNotFound(userId);
    return updated;
  }
}

/**
 * Rebuilt key by key rather than handed to the repository as-is.
 *
 * `exactOptionalPropertyTypes` is on, so `{ theme: undefined }` is a different type from `{}` — and,
 * far more to the point, a different *write*: spread into an UPDATE it names a column it has no
 * value for. `UpdateProfileSchema`'s own refinement guarantees at least one key survives this, so
 * the repository never receives an empty patch.
 */
function toPatch(input: UpdateProfileInput): SettingsPatch {
  return {
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.contentLanguage === undefined ? {} : { contentLanguage: input.contentLanguage }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.weekStartsOn === undefined ? {} : { weekStartsOn: input.weekStartsOn }),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
  };
}

/** §14.1 — a side effect of opening a screen, which is why it is not part of the settings patch. */
@Injectable()
export class MarkChangelogSeen {
  constructor(@Inject(PROFILE_REPOSITORY) private readonly profiles: ProfileRepository) {}

  async execute(userId: string, input: SeenChangelogInput): Promise<Profile> {
    const updated = await this.profiles.markChangelogSeen(userId, input.version);
    if (!updated) throw new ProfileNotFound(userId);
    return updated;
  }
}
