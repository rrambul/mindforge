import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { map, type Observable } from "rxjs";

/**
 * `ETag` + `If-None-Match` on the dashboard reads (§6.1).
 *
 * §6.1 asks for this on "read-heavy dashboard endpoints", and the reason it is worth having is in
 * the same sentence: the insight rollups change once a night. A year of grid is the largest
 * response this API produces and it is identical on every request between two nightly jobs.
 *
 * **The tag is a hash of the serialised body.** The tempting alternative is
 * `daily_activity.rebuilt_at`, and it is wrong in a way that is hard to notice: the same rollup
 * timestamp answers `?from=2026-01-01` and `?from=2025-01-01` with two different bodies, so a
 * client that switched ranges would be told nothing had changed. Hashing what is actually sent
 * cannot go stale that way, and it costs one sha256 over a payload we already serialised.
 *
 * **Why this file lives here.** Insights is its only consumer today, and a `shared/http/` helper
 * written for one caller is speculative generality. It is a file move with no call-site change the
 * day planning's dashboard reads need it, which is the point at which it will have earned the spot.
 *
 * **The reply is reached structurally**, exactly as `problem.filter.ts` does it: `apps/api` never
 * declared `fastify` as a dependency, so importing `FastifyReply` would be importing a package that
 * is not in package.json.
 *
 * Note that the header alone is not the feature. `bootstrap.ts` has to allow `if-none-match` on the
 * preflight and expose `etag` on the response, or a browser strips one and cannot read the other,
 * and this silently never fires. `test/insights.test.ts` drives that preflight directly, because it
 * is not observable through `app.inject()`.
 */

interface RequestLike {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface ReplyLike {
  status(code: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
}

/**
 * Store it, but ask every time.
 *
 * Without a `Cache-Control`, a response carrying a validator is eligible for *heuristic* freshness
 * — the browser may reuse it for a while without asking, which turns a revalidation feature into a
 * staleness bug. `no-cache` means "you may keep this, you may not use it without checking", which
 * is exactly the contract the ETag is here to serve. `private` because every byte of it is one
 * user's data and no shared cache should hold it.
 */
const CACHE_CONTROL = "private, no-cache";

@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestLike>();
    const reply = http.getResponse<ReplyLike>();

    return next.handle().pipe(
      map((body: unknown) => {
        const etag = etagFor(body);
        reply.header("etag", etag).header("cache-control", CACHE_CONTROL);

        if (!matches(request.headers["if-none-match"], etag)) return body;

        // Nest sets the route's status *before* the handler runs and does not re-apply it
        // afterwards, so changing it here is what actually lands. Returning `undefined` rather than
        // sending the reply ourselves keeps Nest as the only thing that writes a response — a
        // second `send()` on the same reply is a framework error, not a smaller body.
        reply.status(304);
        return undefined;
      }),
    );
  }
}

/**
 * A strong tag over the exact bytes the client will receive.
 *
 * `JSON.stringify` because that is what Fastify serialises a plain object with when no response
 * schema is registered, so the hash covers the representation rather than an approximation of it.
 * base64url so the value is safe between quotes without escaping.
 */
function etagFor(body: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(body)).digest("base64url")}"`;
}

/**
 * RFC 9110 §13.1.2: a list, and `*` matches any current representation.
 *
 * The comparison is deliberately weak — `W/"x"` matches `"x"` — because that is what the spec
 * requires of `If-None-Match`, and a client or proxy that downgraded our strong tag would otherwise
 * revalidate forever and never get a 304.
 *
 * Node joins repeated request headers into one string, so anything that is not a string is a header
 * that was not sent.
 */
function matches(header: string | string[] | undefined, etag: string): boolean {
  if (typeof header !== "string") return false;

  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || strong(candidate) === strong(etag));
}

function strong(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}
