import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./shared/config/env.js";
import { requestIdFor } from "./shared/logging/pino-options.js";

/**
 * Builds the application exactly as production runs it.
 *
 * Extracted from `main.ts` so integration tests boot the same object rather than
 * reassembling it. The global prefix in particular is the sort of thing that
 * drifts silently: a test that mounts routes at `/missions` while production
 * serves `/v1/missions` passes and proves nothing.
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, buildAdapter(), {
    // Nest logs module initialisation before any provider exists, so without this
    // the first dozen lines of every boot escape through the default console
    // logger in a different format from everything after them. Buffered, they are
    // replayed through pino the moment `useLogger` below runs.
    bufferLogs: true,
  });

  // Every `new Logger(...)` in the app delegates to whatever is registered here,
  // so the existing call sites — the problem filter, the memory sync — start
  // emitting structured lines with a request id without being touched.
  app.useLogger(app.get(Logger));

  // §6.1 — base path /v1. Cheap now, impossible to retrofit politely.
  app.setGlobalPrefix("v1");

  const env = app.get<Env>(ENV);
  app.enableCors({
    origin: env.APP_ORIGIN,
    credentials: true,
    // Spelled out because `@fastify/cors` defaults to GET,HEAD,POST only — unlike
    // Express's cors, which allows the full set. Without this a browser blocks
    // `PATCH /v1/missions/:id` at the preflight, and the symptom is a CORS error that
    // names the origin rather than the method, so it reads as an origin problem.
    //
    // OPTIONS is absent deliberately: Fastify answers the preflight itself, and listing
    // it would imply a route that does not exist.
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
    // `if-none-match` is the same class of bug as the methods above, one layer down. §6.1 puts
    // ETags on the dashboard reads, and a header a browser is not told it may send is simply
    // stripped at the preflight — so the SPA would revalidate nothing, always get a 200, and the
    // feature would look implemented while never once firing.
    allowedHeaders: ["authorization", "content-type", "if-none-match"],
    // The other half of the same feature. `ETag` is not a CORS-safelisted *response* header, so
    // `response.headers.get("etag")` reads null cross-origin unless it is exposed — and a client
    // that cannot read the tag has nothing to send back in `If-None-Match`. Both directions have
    // to be open or neither does anything, which is why `test/insights.test.ts` asserts both.
    // `x-request-id` for the same reason as `etag`, one concern over: the API stamps
    // every response with the id its logs are keyed by, and a header the browser is
    // not told it may read is a header the SPA cannot put in a bug report.
    exposedHeaders: ["etag", "x-request-id"],
  });

  // Without this, `onModuleDestroy` never runs on SIGTERM — which is how Railway
  // stops a container — and the Postgres pool is dropped mid-query rather than
  // drained.
  app.enableShutdownHooks();

  return app;
}

/**
 * Fastify, told how to identify a request before Nest or pino sees one.
 *
 * **Request identity belongs to Fastify, not to the logger.** `pino-http` accepts
 * a `genReqId` and it is dead configuration here: its middleware reads
 * `req.id = req.id || genReqId(...)`, and Fastify has already assigned an id by
 * then. Setting it there produces no error, no warning, and no request id —
 * `pino-options.ts` has the longer version of that story.
 *
 * So the id is generated here, and everything downstream inherits it: the access
 * log, `request.log`, and the response header the hook below writes.
 */
function buildAdapter(): FastifyAdapter {
  const adapter = new FastifyAdapter({
    genReqId: (request: { headers: Record<string, string | string[] | undefined> }) =>
      requestIdFor(request.headers),
  });

  // Echoed back so the id is reachable from outside the process. Without it the
  // logs are correlated and nobody on the other end of a bug report can name which
  // request to correlate — which is most of the value.
  //
  // `onRequest` rather than `onSend`: it is the earliest hook with a reply, so the
  // header survives every path out of the app, including the ones that never reach
  // a handler.
  adapter.getInstance().addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    done();
  });

  return adapter;
}

/**
 * Local development reads the same `.env.local` the rest of the workspace does.
 *
 * Absence is not an error: in CI and on Railway the environment is already
 * populated, and `loadEnv` is what fails loudly if something is actually missing.
 * Anything already in the environment wins, so an explicit override on the
 * command line still works.
 */
export function loadLocalEnvFile(): void {
  for (const candidate of ["../../.env.local", ".env.local", ".env"]) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Next candidate.
    }
  }
}
