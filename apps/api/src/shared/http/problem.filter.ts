import {
  DEFAULT_LOCALE,
  formatServerMessage,
  isDomainError,
  resolveLocale,
  type Locale,
  type ServerMessageKey,
} from "@mindforge/core";
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { requestContextOf } from "../auth/request-context.js";
import { internalProblem, problemFromDomainError, type ProblemBody } from "./problem.js";

const PROBLEM_CONTENT_TYPE = "application/problem+json";

interface RequestLike {
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * Structural rather than `FastifyReply`, so this file does not import a package
 * `apps/api` never declared and does not have to change if the adapter does.
 */
interface ReplyLike {
  status(code: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
  send(body: unknown): unknown;
}

/**
 * Turns every failure into one wire shape (TECH-DESIGN.md §6.1).
 *
 * Registered as a catch-all `APP_FILTER`, which means it is also the last thing
 * standing between an unexpected exception and the response body. That is why
 * anything not recognised produces a fixed 500 with a catalogued message rather
 * than the exception's own text: `error.message` routinely contains a connection
 * string, a row's contents, or a query. The log gets the detail.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const reply = http.getResponse<ReplyLike>();

    const locale = localeFor(request);
    const instance = request.url ?? "";

    const problem = this.toProblem(exception, locale, instance);

    reply.status(problem.status).header("content-type", PROBLEM_CONTENT_TYPE).send(problem);
  }

  private toProblem(exception: unknown, locale: Locale, instance: string): ProblemBody {
    if (isDomainError(exception)) {
      const problem = problemFromDomainError(exception, locale, instance);
      // 401s are routine — an expired token on a backgrounded tab produces one
      // every time. Logged at debug so they do not drown the signal, but not
      // dropped, because a burst of them is worth being able to see. No domain
      // kind maps to 5xx, so there is nothing here to log at error level.
      const level = problem.status === 401 ? "debug" : "warn";
      this.logger[level](`${exception.name}: ${exception.message} (${instance})`);
      return problem;
    }

    if (exception instanceof HttpException) {
      // Nest's own exceptions: an unmatched route, a payload over the body limit.
      // They arrive with a status but no catalogued message, so the status picks
      // one — never the exception's text, which is English framework copy.
      const status = exception.getStatus();
      // A 5xx from the framework is as much a bug as an unhandled throw, so it gets
      // the same treatment: error level, with the stack. Logging it at `warn` with no
      // stack is how a genuine fault goes unnoticed among validation failures.
      if (status >= 500) {
        this.logger.error(`${exception.name}: ${exception.message} (${instance})`, exception.stack);
      } else {
        this.logger.warn(`${exception.name}: ${exception.message} (${instance})`);
      }
      return {
        type: `https://mindforge.app/errors/http-${status}`,
        title: exception.name,
        status,
        detail: formatServerMessage(locale, detailKeyForStatus(status)),
        instance,
        errors: [],
      };
    }

    this.logger.error(
      `Unhandled ${describeType(exception)} (${instance})`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return internalProblem(locale, instance);
  }
}

/**
 * The 4xx fallback is the point of this function.
 *
 * `error.internal` reads "Something went wrong on our end. Nothing you did caused
 * this." On a 413, 405, or 415 that is simply false — the request *was* the problem —
 * and non-negotiable #10 is that the app does not state things that aren't true.
 * Anything 4xx without more specific copy gets the neutral message instead.
 */
function detailKeyForStatus(status: number): ServerMessageKey {
  if (status === 401) return "error.unauthenticated";
  if (status === 403) return "error.forbidden";
  if (status === 404) return "error.not_found";
  if (status === 422 || status === 400) return "error.validation_failed";
  if (status >= 400 && status < 500) return "error.bad_request";
  return "error.internal";
}

/**
 * The user's stored locale when we know who they are, `Accept-Language` when we
 * do not.
 *
 * This is not a contradiction of §5.2's "resolved from the user's stored locale,
 * not a request header". That rule is about users whose preference is known — and
 * for those, the context wins here. A request that failed *before* authentication
 * has no stored preference to consult, so the header is the only signal available
 * and using it beats defaulting a Brazilian user to English on the sign-in error
 * they are most likely to see.
 */
function localeFor(request: RequestLike): Locale {
  const context = requestContextOf(request);
  if (context) return context.locale;

  const header = request.headers["accept-language"];
  if (typeof header !== "string") return DEFAULT_LOCALE;

  // Highest-priority tag only. Full q-value negotiation would let a header
  // decide between two locales the user never chose, which is not worth the code.
  const first = header.split(",")[0]?.split(";")[0];
  return resolveLocale(first);
}

function describeType(exception: unknown): string {
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
  return typeof exception;
}
