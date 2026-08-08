import type {
  NotificationPref,
  SeenChangelogInput,
  UpdateNotificationPrefsInput,
  UpdateProfileInput,
} from "@mindforge/core";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import {
  DuplicateNotificationKind,
  NotificationNotFound,
  ProfileNotFound,
} from "../domain/errors.js";
import { mergeNotificationPrefs, readStoredPref } from "../domain/notification-prefs.js";
import type { Notification } from "../domain/notification.js";
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from "../domain/notification.repository.js";
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

/**
 * What the stored rows mean, once the defaults have filled in the gaps.
 *
 * Shared by the read and the write so the two cannot disagree about what "effective" means — the
 * response to a PUT is the same answer a subsequent GET gives, which is what makes the settings
 * screen able to trust its own optimistic update.
 */
async function effectivePrefs(
  repository: NotificationRepository,
  userId: string,
): Promise<readonly NotificationPref[]> {
  const stored = await repository.prefs(userId);
  // `flatMap` over a nullable parse: a row this build cannot understand contributes nothing and the
  // merge below hands back the default for that kind, rather than the whole screen failing over one
  // row written by an older version.
  return mergeNotificationPrefs(stored.flatMap((row) => readStoredPref(row) ?? []));
}

@Injectable()
export class ReadNotificationPrefs {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  execute(userId: string): Promise<readonly NotificationPref[]> {
    return effectivePrefs(this.notifications, userId);
  }
}

@Injectable()
export class SaveNotificationPrefs {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  async execute(
    userId: string,
    input: UpdateNotificationPrefsInput,
  ): Promise<readonly NotificationPref[]> {
    const seen = new Set<string>();
    for (const pref of input.prefs) {
      if (seen.has(pref.kind)) throw new DuplicateNotificationKind(pref.kind);
      seen.add(pref.kind);
    }

    await this.notifications.savePrefs(userId, input.prefs);
    // Read back rather than echoed: the caller may have sent one kind, and the effective answer
    // includes the other kind's stored row or default.
    return effectivePrefs(this.notifications, userId);
  }
}

@Injectable()
export class ListNotifications {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  execute(userId: string): Promise<Notification[]> {
    return this.notifications.listUndismissed(userId);
  }
}

@Injectable()
export class DismissNotification {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, id: string): Promise<Notification> {
    const notification = await this.notifications.findById(userId, id);
    if (!notification) throw new NotificationNotFound(id);

    notification.dismiss(this.clock.now());
    await this.notifications.save(userId, notification);
    return notification;
  }
}
