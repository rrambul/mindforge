import type { Locale, WeekStart } from "@mindforge/core";
import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../../../shared/auth/current-user.decorator.js";
import type { RequestContext } from "../../../shared/auth/request-context.js";

/**
 * Who the caller is, and the settings that change what everything else means.
 *
 * The SPA needs this before it renders a single string. Server-side error `detail` is
 * translated from the *stored* locale (§5.2), so a client that guessed its language
 * from the browser would show a Portuguese interface with English errors, or the
 * reverse — the two would drift from the first request. One source of truth, read
 * once at startup.
 *
 * `timezone` and `weekStartsOn` come along because every "day" and "week" in the
 * product derives from them, and the client formats dates locally.
 */
export interface MeView {
  readonly userId: string;
  readonly locale: Locale;
  /** IANA. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

@Controller("me")
export class MeController {
  /**
   * No use case and no repository: the auth guard already loaded exactly this, so a
   * second read would be a round trip to learn what the request context knows.
   * §2.1 — add layers when there is an invariant to protect.
   */
  @Get()
  get(@CurrentUser() user: RequestContext): MeView {
    return {
      userId: user.userId,
      locale: user.locale,
      timezone: user.timezone,
      weekStartsOn: user.weekStartsOn,
    };
  }
}
