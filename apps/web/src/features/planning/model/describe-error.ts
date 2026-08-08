import { ApiError, NetworkError } from "../../../shared/api/problem.js";

/**
 * A failure, in words the user can act on.
 *
 * The same three-way split every route in this app makes — it is written out again in `SkillsRoute`
 * and `TodayScreen` — pulled into one function here because this slice has three routes that would
 * otherwise each carry a copy. It stays inside the feature rather than moving to `shared/`: the two
 * older copies are not this slice's to change, and one shared version imposed on them is a refactor
 * of files nobody asked to touch.
 *
 * The distinction that matters is the first one. A request that never reached the server has not
 * failed in a way the user can fix by reading the server's `detail` — there is no `detail`.
 */
export function describeError(error: unknown, common: (key: string) => string): string {
  if (error instanceof NetworkError) return common("state.offline");
  if (error instanceof ApiError && error.problem) return error.problem.detail;
  return common("error.unexpectedBody");
}
