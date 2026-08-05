import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { UnauthenticatedError } from "../errors/common-errors.js";
import { requestContextOf, type RequestContext } from "./request-context.js";

/**
 * Throws rather than returning null when there is no context, because reaching
 * this on a `@Public()` route is a wiring mistake. The alternative is a handler
 * quietly receiving `undefined` and writing rows owned by nobody.
 *
 * Extracted from the decorator so it can be tested directly — a param decorator
 * is otherwise only reachable by booting Nest.
 */
export function currentUserFrom(context: ExecutionContext): RequestContext {
  const request = context.switchToHttp().getRequest<object>();
  const ctx = requestContextOf(request);
  if (!ctx) throw new UnauthenticatedError("handler requires a user but none was established");
  return ctx;
}

/** The request context, for a controller that needs it. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  currentUserFrom(context),
);
