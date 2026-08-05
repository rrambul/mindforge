import type { Locale, WeekStart } from "@mindforge/core";

/**
 * Who is asking, and the three settings that change what the answer means.
 *
 * Timezone and week start are here rather than fetched per use case because
 * almost every read in this product buckets by day or week, and TECH-DESIGN.md
 * §5.2 is explicit that those buckets derive from the user's stored preferences
 * rather than server-local time. Locale is here so the HTTP boundary can
 * translate an error's `detail` without the use case that raised it knowing
 * anything about language.
 */
export interface RequestContext {
  readonly userId: string;
  readonly locale: Locale;
  /** IANA. Every "day", "week", and scheduled job derives from this. */
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

/**
 * Attached out-of-band rather than by assigning a property to the request.
 *
 * A WeakMap needs no module augmentation of Fastify's types, cannot collide with
 * a plugin's property, and cannot be reached by anything that has not imported
 * this module — so a controller cannot quietly read `request.userId` and skip the
 * guard. Entries are collected with the request object.
 */
const contexts = new WeakMap<object, RequestContext>();

export function attachRequestContext(request: object, context: RequestContext): void {
  contexts.set(request, context);
}

/** Null on a `@Public()` route, where no user has been established. */
export function requestContextOf(request: object): RequestContext | null {
  return contexts.get(request) ?? null;
}
