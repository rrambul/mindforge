import { TeachRuns } from "@mindforge/api/teach";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkerModule } from "../src/app.module.js";
import { TeachModule } from "../src/modules/teach/presentation/teach.module.js";

/**
 * The R3 spike, as a test rather than as a one-off probe.
 *
 * §2.1 decision 2 — "the worker calls the API's use cases; it does not
 * reimplement writes" — was false for two milestones. `apps/api` declared no
 * `main`, no `types` and no `exports` map, so `@mindforge/api` was a workspace
 * name that resolved to nothing, while `missions.module.ts` carried an `exports:`
 * line since M1 saying the worker would call them directly. A rule that outlives
 * the code is how that dead line happened, and this is what stops it recurring.
 *
 * Three things could break it, and none of them would be obvious from a
 * typecheck:
 *
 *   1. **The tokens.** Both apps declare `CLOCK`, and `Symbol("Clock")` is never
 *      equal to another `Symbol("Clock")`. Binding the worker's would leave the
 *      API's use cases unresolvable with an error naming a token that reads
 *      identically to one that is bound.
 *   2. **`SharedModule` leaking in.** It provides `APP_GUARD` and a Supabase JWKS
 *      verifier, so a transitive import would make a process that serves no HTTP
 *      refuse to boot without `SUPABASE_URL`.
 *   3. **The build layout.** Packages resolve to `dist` outside the `development`
 *      condition, so the exports map has to point at files `nest build` actually
 *      emits.
 */

describe("the worker's container can resolve the API's use cases", () => {
  let context: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;

  beforeAll(async () => {
    // `compile()` and deliberately **not** `init()`. `NightlyScheduler` implements
    // `onApplicationBootstrap` and ticks immediately rather than after the first
    // interval — correct in production, where a worker restarted at 09:00 should
    // catch up on the night it missed. Here it would run a real rollup against
    // the developer's database and write `daily_activity` rows for every profile.
    //
    // Resolution is what this file is about, and `get()` works after `compile()`:
    // the providers are constructed, the lifecycle hooks are not.
    context = await Test.createTestingModule({ imports: [WorkerModule, TeachModule] }).compile();
  });

  afterAll(async () => {
    await context.close();
  });

  it("resolves TeachRuns, which the worker did not write", () => {
    // The whole point. If this throws, it throws with "Nest can't resolve
    // dependencies of TeachRuns" and names the token that is missing.
    expect(context.get(TeachRuns, { strict: false })).toBeInstanceOf(TeachRuns);
  });

  it("gives it the worker's service-role database rather than the request-scoped one", async () => {
    // Same use case, different `UserScopedDb` — which is what
    // `shared/persistence/user-scoped-db.ts` predicted in M2 and what makes "the
    // worker does not reimplement writes" true rather than aspirational.
    const runs = context.get(TeachRuns, { strict: false });

    // A read through the full stack: use case → repository → ServiceRoleDb →
    // Prisma. A wrong binding fails here rather than during a real run.
    await expect(
      runs.listForMission(
        "00000000-0000-4000-8000-000000000000",
        "00000000-0000-4000-8000-000000000001",
        1,
      ),
    ).resolves.toEqual([]);
  });

  it("boots without the API's auth chain", () => {
    // `SharedModule` is not imported, so `TOKEN_VERIFIER` must be absent. Present,
    // it would demand SUPABASE_URL and JWKS — in a process that serves no HTTP.
    expect(() => context.get<unknown>(Symbol.for("TokenVerifier"), { strict: false })).toThrow();
  });
});
