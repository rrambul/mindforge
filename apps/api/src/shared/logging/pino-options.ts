import { randomUUID } from "node:crypto";

import type { Env } from "../config/env.js";

/**
 * The logger's configuration, as a pure function of the environment.
 *
 * Separated from the module that installs it so it can be tested at all. Inside a
 * `forRootAsync` factory this was three behaviours — the level, the redaction, the
 * health exclusion — that could only be exercised by booting the app and scraping
 * stdout, which is why the first version of this file had no tests.
 */
export function pinoHttpOptions(env: Env): PinoHttpOptions {
  return {
    /**
     * Silent under test rather than merely quiet.
     *
     * The integration suite boots this app once per file, and a request line per
     * injection buries the assertion that actually failed. A test that wants to
     * observe logging sets `LOG_LEVEL` and reads the stream — which is possible
     * precisely because this is a function.
     */
    level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,

    /**
     * pino's default serializer logs every request header, which means a bearer
     * token per line — an access token good for an hour, sitting in whatever
     * aggregates the logs.
     *
     * Redacted rather than removed so the key stays visible: "was a token even
     * sent?" is the first question on a 401, and a missing property cannot answer
     * it.
     */
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
      censor: "[redacted]",
    },

    autoLogging: {
      /**
       * The liveness probe is the loudest thing in the file and says nothing.
       *
       * Suppressed here rather than by excluding the route from the middleware:
       * excluding it would also drop the request context, so anything the handler
       * logged would lose its id.
       *
       * **`originalUrl` first, and that is not belt-and-braces.** Nest mounts its
       * middleware through `@fastify/middie`, which strips the matched prefix from
       * `req.url` before handing the request on — and with the global prefix the
       * pattern matches the whole of `/v1/health`, so by the time this predicate
       * runs `req.url` is `"/"`. Matching on it alone logged every probe while
       * every unit test of the policy passed; it was found by curling a running
       * server. Middie sets `originalUrl` to the untouched path for exactly this.
       */
      ignore: (req: IncomingLike): boolean =>
        (req.originalUrl ?? req.url ?? "").split("?")[0] === "/v1/health",
    },

    /** Two processes will ship to one place as soon as the worker logs too. */
    customProps: () => ({ service: "api" }),
  };
}

/**
 * The request id, and **why it is not configured on `pino-http`.**
 *
 * `pino-http` takes a `genReqId`, and giving it one here looks right and does
 * nothing: its middleware reads `req.id = req.id || genReqId(...)`, and under the
 * Fastify adapter the id is already set by the time the middleware runs. The
 * function is never called, the log carries Fastify's `req-1`, `req-2`, … and no
 * response header is ever written — a failure with no error, which is how the
 * first version of this shipped green tests and no request ids.
 *
 * So Fastify generates it, on the adapter, and `pino-http` inherits it. One
 * counter, one id, one place to change it.
 *
 * Honours an id the edge already assigned so a request keeps one id across the
 * proxy, and mints a uuid otherwise — Fastify's default is a per-process counter,
 * which collides across replicas the moment there is more than one container.
 */
export function requestIdFor(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string {
  return safeRequestId(headers["x-request-id"]) ?? randomUUID();
}

/**
 * An inbound request id is only usable if it cannot forge a log entry.
 *
 * Returns null for anything that is not a single line of url-safe characters, at
 * which point the caller mints its own. Rejecting rather than sanitising is the
 * right call: a value that had to be rewritten to be safe was not the id the edge
 * assigned, and silently correlating against a mangled one is worse than not
 * correlating at all.
 *
 * The length cap matters for the same reason: the value is attacker-controlled and
 * lands in a log aggregator, so an unbounded one is a cheap way to write a
 * megabyte per request into somebody's retention bill.
 */
export function safeRequestId(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 128) return null;
  return /^[\w.:-]+$/.test(value) ? value : null;
}

/**
 * Structural, for the reason `problem.filter.ts` gives: naming `IncomingMessage`
 * would tie the logger's configuration to the HTTP adapter, and this file is meant
 * to be a description of policy rather than of a framework.
 */
interface IncomingLike {
  /** What arrived, before middie rewrote `url`. See `autoLogging.ignore`. */
  readonly originalUrl?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * `paths` is a mutable array rather than a `readonly` one because pino's own
 * `redactOptions` declares it that way, and a `readonly` here fails to assign with
 * a variance error six frames deep in `nestjs-pino`'s `Params`.
 */
export interface PinoHttpOptions {
  readonly level: string;
  readonly redact: { readonly paths: string[]; readonly censor: string };
  readonly autoLogging: { readonly ignore: (req: IncomingLike) => boolean };
  readonly customProps: () => Record<string, string>;
}
