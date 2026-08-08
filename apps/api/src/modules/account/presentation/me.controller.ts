import {
  SeenChangelogSchema,
  UpdateNotificationPrefsSchema,
  UpdateProfileSchema,
  type Locale,
  type NotificationPref,
  type SeenChangelogInput,
  type UpdateNotificationPrefsInput,
  type UpdateProfileInput,
  type WeekStart,
} from "@mindforge/core";
import { Body, Controller, Get, HttpCode, Patch, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";
import { zodPipe } from "../../../shared/validation/zod-validation.pipe.js";
import {
  MarkChangelogSeen,
  ReadNotificationPrefs,
  ReadProfile,
  SaveNotificationPrefs,
  UpdateSettings,
} from "../application/account.use-cases.js";
import type { Profile, Theme } from "../domain/profile.js";

/**
 * Who the caller is, and the settings that change what everything else means.
 *
 * The SPA needs this before it renders a single string. Server-side error `detail` is translated
 * from the *stored* locale (§5.2), so a client that guessed its language from the browser would
 * show a Portuguese interface with English errors, or the reverse — the two would drift from the
 * first request. One source of truth, read once at startup.
 *
 * `timezone` and `weekStartsOn` come along because every "day" and "week" in the product derives
 * from them, and the client formats dates locally. `contentLanguage` and `theme` joined them in M2
 * when the settings screen gained the ability to write them, and `changelogSeenVersion` because the
 * unseen dot is computed against it (§14.1) — null there means never opened, not up to date.
 */
export interface MeView {
  readonly userId: string;
  readonly locale: Locale;
  /** What the agent writes lessons in. A separate setting from `locale` (FR-L3). */
  readonly contentLanguage: Locale;
  /** IANA. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
  readonly theme: Theme;
  /** Null means the changelog has never been opened, which is not the same as "up to date". */
  readonly changelogSeenVersion: string | null;
}

export function toMeView(profile: Profile): MeView {
  return {
    userId: profile.userId,
    locale: profile.locale,
    contentLanguage: profile.contentLanguage,
    timezone: profile.timezone,
    weekStartsOn: profile.weekStartsOn,
    theme: profile.theme,
    changelogSeenVersion: profile.changelogSeenVersion,
  };
}

@Controller("me")
export class MeController {
  constructor(
    private readonly profile: ReadProfile,
    private readonly settings: UpdateSettings,
    private readonly changelog: MarkChangelogSeen,
    private readonly readPrefs: ReadNotificationPrefs,
    private readonly writePrefs: SaveNotificationPrefs,
  ) {}

  /**
   * Answered from the repository rather than from `RequestContext`, which is a change from M1.
   *
   * The guard loads four of these seven fields, and `contentLanguage`, `theme` and
   * `changelogSeenVersion` are not among them — widening `RequestContext` to carry three settings no
   * other endpoint consults would make every request pay for this one. Serving half the view from
   * the context and half from a row is the worse option again: the two would be read at different
   * moments, and a settings write landing in between would produce a response that contradicts
   * itself.
   */
  @Get()
  async get(@CurrentUser() user: RequestContext): Promise<MeView> {
    return toMeView(await this.profile.execute(user.userId));
  }

  /**
   * The settings write path (FR-L3, FR-L5). Absent means unchanged.
   *
   * **Changing `timezone` or `weekStartsOn` invalidates every "this week" and "today" bucket the
   * client is holding.** The plan grid, the activity grid, the day boundaries in the session list —
   * all of them are derived from these two, and none of them re-derive themselves. Whoever wires
   * this mutation has to invalidate those queries wholesale rather than patching the profile in
   * place, or the user changes their timezone and watches yesterday's sessions stay on yesterday.
   */
  @Patch()
  async update(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(UpdateProfileSchema)) body: UpdateProfileInput,
  ): Promise<MeView> {
    return toMeView(await this.settings.execute(user.userId, body));
  }

  /**
   * §14.1 — you opened the changelog.
   *
   * Its own endpoint rather than a field on the patch above, on purpose: this is a side effect of
   * looking at a screen, not a setting, and folding it in would let a theme change clear the unseen
   * dot. 200 rather than 201 because nothing is created; the updated profile comes back so the
   * client can drop the dot without a second round trip.
   */
  @Post("changelog-seen")
  @HttpCode(200)
  async seenChangelog(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(SeenChangelogSchema)) body: SeenChangelogInput,
  ): Promise<MeView> {
    return toMeView(await this.changelog.execute(user.userId, body));
  }

  /**
   * The effective preferences: stored rows merged over `defaultNotificationPrefs()`.
   *
   * A user with no rows gets every kind at its defaults rather than an empty list — "quiet by
   * default" is a delivery decision, not an off switch (FR-N4), so nothing is off until it is
   * switched off. Nothing is seeded on this read: a seeded row would freeze today's defaults into
   * an account forever.
   */
  @Get("notification-prefs")
  async notificationPrefs(
    @CurrentUser() user: RequestContext,
  ): Promise<{ prefs: readonly NotificationPref[] }> {
    return { prefs: await this.readPrefs.execute(user.userId) };
  }

  /**
   * `PUT` because each named pref row is replaced whole — `kind` is the key and `config` is a whole
   * object, so sending it twice leaves the same state.
   *
   * Kinds the body does not name are left alone rather than deleted. Deleting them would mean "reset
   * to default", which is a different thing from "I did not send it" — and it is the same silent
   * revert `UpdateProfileSchema` refuses to build into the profile patch.
   *
   * Returns the full effective set, not an echo, so the response answers the question the next GET
   * would.
   */
  @Put("notification-prefs")
  async updateNotificationPrefs(
    @CurrentUser() user: RequestContext,
    @Body(zodPipe(UpdateNotificationPrefsSchema)) body: UpdateNotificationPrefsInput,
  ): Promise<{ prefs: readonly NotificationPref[] }> {
    return { prefs: await this.writePrefs.execute(user.userId, body) };
  }
}
