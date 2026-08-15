import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import type { Observable } from "rxjs";

import { requestContextOf } from "../auth/request-context.js";

/**
 * Puts the authenticated user on every line this request produces.
 *
 * Registered as an `APP_INTERCEPTOR`, which is what places it correctly in the
 * chain: guards run first, so by the time this executes `SupabaseAuthGuard` has
 * either attached a `RequestContext` or rejected the request outright. An
 * interceptor is also the cheapest place to do this — the alternative was
 * injecting `PinoLogger` into the guard, which would make the single most
 * security-critical class in the app depend on a logging package.
 *
 * **Only the user id and their timezone.** Not the locale, not the week start,
 * and above all not the token: a log line is the one artefact that outlives the
 * request, gets shipped to a third party, and is read by people who were never
 * granted access to the account. The id is what makes an incident traceable; the
 * rest is preference data that would just be sitting there.
 *
 * The timezone earns its place because almost every read in this product buckets
 * by day (§5.2), so "the grid looked wrong" is a question you cannot answer
 * without knowing which midnight the request was asking about.
 */
@Injectable()
export class RequestLogContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only HTTP has a request to read. The worker imports this app's use cases
    // directly and never builds an execution context, but a future queue consumer
    // would — and `switchToHttp()` on one of those returns an empty shell whose
    // `getRequest()` is undefined.
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest<object | undefined>();
    const requestContext = request ? requestContextOf(request) : null;

    // Null on a `@Public()` route — sign-in, the health probe. Nothing to add, and
    // the request log still carries its own id.
    if (requestContext) {
      this.logger.assign({
        userId: requestContext.userId,
        timezone: requestContext.timezone,
      });
    }

    return next.handle();
  }
}
