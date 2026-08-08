/**
 * The DI tokens and abstractions a second Nest context has to bind.
 *
 * `apps/worker` imports the API's use cases and therefore has to satisfy what
 * they inject. Only the *contracts* are exported — the tokens, the interfaces,
 * and the errors — never `SharedModule` itself.
 *
 * That exclusion is the important part. `SharedModule` also provides `APP_GUARD`,
 * `APP_FILTER` and a Supabase JWKS verifier, so importing it into the worker
 * would make a process that serves no HTTP refuse to boot without `SUPABASE_URL`
 * — the exact failure `apps/worker/src/shared/env.ts` cites as the reason
 * `REDIS_URL` is absent from its schema. The worker binds these tokens to its own
 * implementations instead, which is why `TeachModule` declares no `imports`.
 */

export { PRISMA, USER_SCOPED_DB, type UserScopedDb } from "./persistence/user-scoped-db.js";

export { ID_GENERATOR, type IdGenerator } from "./ids/id-generator.js";
export { CLOCK, type Clock } from "./time/clock.js";
