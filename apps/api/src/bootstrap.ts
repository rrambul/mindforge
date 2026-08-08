import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./shared/config/env.js";

/**
 * Builds the application exactly as production runs it.
 *
 * Extracted from `main.ts` so integration tests boot the same object rather than
 * reassembling it. The global prefix in particular is the sort of thing that
 * drifts silently: a test that mounts routes at `/missions` while production
 * serves `/v1/missions` passes and proves nothing.
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

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
    exposedHeaders: ["etag"],
  });

  // Without this, `onModuleDestroy` never runs on SIGTERM — which is how Railway
  // stops a container — and the Postgres pool is dropped mid-query rather than
  // drained.
  app.enableShutdownHooks();

  return app;
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
