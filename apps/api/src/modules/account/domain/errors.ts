import {
  DomainError,
  type DomainErrorKind,
  type FieldViolation,
  type ServerMessageKey,
} from "@mindforge/core";

/**
 * These three carry the *generic* catalogue keys rather than `error.account.*` ones.
 *
 * Not laziness: `packages/core` owns the message bundle, adding a key there is a change to a shared
 * package, and neither of these errors says anything a user-facing string could usefully
 * particularise. "We couldn't find that" is the whole content of both not-founds.
 */

/**
 * The caller's own profile row is gone.
 *
 * All but unreachable — the auth guard reads the row *in order to* build the request context, so it
 * existed a moment ago. Modelled anyway because the repository returns `Profile | null` and the
 * alternative is a non-null assertion on a value the database owns: if an account is deleted
 * mid-request, this is a 404 rather than a `TypeError` at the view mapper.
 */
export class ProfileNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "profile-not-found";
  readonly detailKey: ServerMessageKey = "error.not_found";

  constructor(userId: string) {
    super(`No profile for ${userId}`);
  }
}

/** Another user's notification is missing rather than forbidden — RLS makes them the same thing. */
export class NotificationNotFound extends DomainError {
  readonly kind: DomainErrorKind = "not_found";
  readonly slug = "notification-not-found";
  readonly detailKey: ServerMessageKey = "error.not_found";

  constructor(id: string) {
    super(`Notification ${id} not found`);
  }
}

/**
 * The same kind twice in one prefs write.
 *
 * Refused rather than resolved last-wins, because the two entries disagree about what the user
 * wants and picking one silently is how a settings screen reports success for a setting that did
 * not take. The schema cannot catch it: `kind` is the discriminator of the union, not a key of an
 * object, so an array of two `stall` prefs is well-formed.
 */
export class DuplicateNotificationKind extends DomainError {
  readonly kind: DomainErrorKind = "invalid";
  readonly slug = "duplicate-notification-kind";
  readonly detailKey: ServerMessageKey = "error.validation_failed";
  override readonly violations: readonly FieldViolation[];

  constructor(duplicated: string) {
    super(`Notification kind ${duplicated} appears twice`);
    this.violations = [{ field: "prefs", code: "duplicate", message: this.message }];
  }
}
