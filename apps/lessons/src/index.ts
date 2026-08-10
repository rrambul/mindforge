/**
 * Lessons origin — serves agent-generated workspace files.
 *
 * Runs on Bun: this service is pure I/O (fetch bytes from Storage, stream them
 * out) with no Prisma and no Nest, which is exactly where Bun's advantage is
 * real. It is also fully isolated, so a problem here cannot reach the API.
 *
 * SECURITY — the whole point of this service (TECH-DESIGN.md §7.5):
 * Lesson HTML is LLM-authored JavaScript. It is untrusted. This process exists
 * so that content runs on an origin that has NO access to the app's cookies,
 * localStorage, or Supabase session. Do not merge it into the API to save a
 * deployment, and do not relax the headers in `handler.ts` to make something work.
 *
 * The routing, the grant check and those headers live in `handler.ts`, which takes
 * its Storage as a port — so the tests that matter here (what it refuses to serve)
 * run against a map of bytes rather than a live bucket.
 */
import { loadEnv } from "./env.js";
import { createHandler } from "./handler.js";
import { SupabaseWorkspaceObjects } from "./objects.js";

/**
 * `.env.local` is loaded by `--env-file` in this package's scripts rather than in
 * code. Bun has no `process.loadEnvFile` — the trick `apps/api` and `apps/worker`
 * use — and it ignores the flag silently when the file is absent, which is the
 * behaviour their try/catch was written to get. In CI and on Railway the
 * environment is already populated and no file exists, which is not an error.
 */
const env = loadEnv(Bun.env);

const server = Bun.serve({
  port: env.port,
  fetch: createHandler({
    env,
    objects: new SupabaseWorkspaceObjects(env.supabaseUrl, env.serviceRoleKey),
    // Seconds, because that is what a grant's expiry is measured in.
    now: () => Math.floor(Date.now() / 1000),
  }),
});

console.log(
  JSON.stringify({
    msg: "lessons origin listening",
    port: server.port,
    appOrigin: env.appOrigin,
  }),
);
