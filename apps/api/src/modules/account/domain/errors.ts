import { DomainError, type DomainErrorKind, type ServerMessageKey } from "@mindforge/core";

/**
 * This carries the *generic* catalogue key rather than an `error.account.*` one.
 *
 * Not laziness: `packages/core` owns the message bundle, adding a key there is a change to a shared
 * package, and this error says nothing a user-facing string could usefully particularise.
 * "We couldn't find that" is the whole content of the not-found.
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
