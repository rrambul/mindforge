# CLAUDE.md

Mindforge — a personal system for tracking learning, attention, and cognitive friction.

## Read first

| Doc                                    | For                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`NORTHSTAR.md`](./NORTHSTAR.md)       | The destination, the principles, and which milestone we're on                                       |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | What to build. Requirements are referenced by ID (FR-S3, FR-C1…) — use those IDs in commits and PRs |
| [`TECH-DESIGN.md`](./TECH-DESIGN.md)   | How to build it: architecture, schema, algorithms, testing                                          |

Don't restate these docs here. When something changes, update the doc, not this file.

## Status

**M1 — the capture loop — in progress** (`NORTHSTAR.md` §4).

Done in M0: monorepo, `packages/core` (scoring, decay, bands, friction classification — 100% covered), Prisma schema for the whole M1 slice, RLS on every table, CI, hooks, design tokens.

Done in M1 so far: the server message bundle (`packages/core/src/i18n`), the API request foundation (auth guard, RFC 7807 errors, Zod validation, RLS-scoped access), the **missions module** (create, edit with revision history, park/unpark, WIP limit of 3), `GET /v1/me`, the **web app shell** (Supabase browser auth, TanStack Query, react-i18next with ICU in en + pt-BR, shared/ui on the Temper tokens), and **the capture loop** — focus timer with intention, stop, ≤30s debrief, manual/retroactive entry, one-tap typed friction with the ranked-four chips, and the ember/slag split.

`pnpm dev` gives you a sign-in screen, then Today (start focus → chips → stop → debrief) and Missions.

The loop is usable. **What M1 needs next is three weeks of you actually using it** (`NORTHSTAR.md` §4, sequencing rule 1) — not more features. If capture doesn't stick, nothing downstream fixes it.

Then, in rough order: the offline queue (§5 — it wraps the capture mutations, which are already optimistic and idempotent, so it is additive), notes on anything (FR-N1..N3), resources with URL capture, goals with typed targets, and skills. There is deliberately **no router yet**: two screens do not need a route tree, and it should be designed against real routes once Today grows a "next" block and mission detail exists to link to.

Two interim proxies in the friction maths are marked in the code and expire in M2/M5: `producedLearning` reads the session's own debrief because §9.3's definition needs learning records and reviews; and the ember/slag split weights each event as one minute, so it is currently a _count_ share.

Three checks run outside the test suites, all wired into CI: `pnpm check:boundaries` (the architecture rules actually fire), `pnpm check:i18n` (FR-L7), and the per-package coverage gates.

Two M0 claims turned out not to hold, both fixed:

- **`withRls` isolated nothing.** It set `request.jwt.claims` but Prisma connects as `postgres`, which owns the tables — policies never applied, and every query returned every user's rows. Replaced by `runAsUser`, which also switches role. FR-A3 rested entirely on this.
- **No Nest app could boot.** Workspace packages exported raw `.ts`, so Node choked on `export type`. Nobody found it because M0's finish line was a deployed URL and deployment was deferred.

Deferred deliberately: **Railway is not provisioned.** Deploying an empty skeleton costs money and shows a blank page; revisit at the end of M1. **No cloud Supabase project either** — the org is at its 2-project free limit, and local is sufficient until deploy. **CI does not run integration or E2E tests yet** — there is no Postgres in the workflow, so `test:coverage` measures unit coverage only and says so in `apps/api/vitest.config.ts`.

## Getting started

```sh
supabase start                                # local Postgres + Auth + Storage
pnpm install                                  # postinstall runs prisma generate
pnpm --filter @mindforge/db exec prisma migrate deploy
pnpm dev                                      # api on :3000, web on :5173
```

`.env.local` holds the local connection strings and is gitignored; `packages/db/.env` is a copy the Prisma CLI reads. `.env.example` documents the shape.

## Commands

```sh
pnpm dev             # all services (turbo)
pnpm build           # packages to dist, then the apps
pnpm typecheck       # tsc across the workspace — builds packages first
pnpm lint            # eslint, including the boundary rules
pnpm test:coverage   # unit + the coverage gate
pnpm format          # prettier — run before committing

pnpm --filter @mindforge/api test:integration  # real Postgres + Auth (needs supabase start)
pnpm --filter @mindforge/db exec vitest run    # RLS tests (needs supabase start)
pnpm --filter @mindforge/db generate           # regenerate the Prisma client
```

## Environment facts that bite

- **Runtimes are not uniform.** `apps/lessons` runs on Bun (pure I/O, no Prisma, no Nest, isolated by design); everything else is Node 22.

- **Workspace packages are dual-entry.** `@mindforge/core|db|llm` export `src/*.ts` under the `development` condition and `dist/` otherwise. `dev` passes `--conditions=development`, so editing a package needs no rebuild; `build` and `typecheck` read `dist`, which is why `turbo` declares them `dependsOn: ["^build"]`. Running `tsc --noEmit` in one app directly, without building packages first, reports the packages as missing — use `pnpm typecheck`.

- **Nest apps run through `@swc-node/register`, not `nest start`.** SWC is the only fast transpiler that emits `emitDecoratorMetadata`, which Nest's DI needs; esbuild and tsx silently do not, and every class-typed constructor parameter then fails to resolve. `pnpm build` + `pnpm start` runs plain compiled JS with no loader.

- **`tsBuildInfoFile` lives inside `dist/`** in every `tsconfig.build.json`. With it at the package root, `rm -rf dist` leaves tsc believing everything is current: the next build prints nothing, exits 0, emits no JS, and the failure surfaces much later as a missing module at runtime.

- **The architectural boundary rules need `boundaries/root-path` and a TypeScript import resolver, or they silently enforce nothing.** Lint runs per package, so patterns are matched relative to the package dir unless root-path is anchored; and TS's ESM convention (`./foo.js` for `foo.ts`) is unresolvable to the default node resolver, which classifies every internal import as unknown and leaves the rule with nothing to check. `pnpm check:boundaries` asserts violations are still reported — run it after touching `eslint.config.mjs`.

- **`*.module.ts` is exempt from the boundary rule.** A Nest module's job is binding abstractions to implementations, which cannot be written without naming the implementation (TECH-DESIGN.md §2.1's own example does it). The exemption is scoped to that filename; a controller importing a repository is still an error.

- **The web dev server uses `strictPort`.** Vite's default is to increment to the next free port, and the port is load-bearing: the API's CORS allow-list is exactly `APP_ORIGIN`, so a silent move to 5174 turns every request into a preflight failure whose message names the _origin_ rather than the port. `Port 5173 is in use` is a diagnosis; a wall of CORS errors is a puzzle.

- **CORS methods are listed explicitly.** `@fastify/cors` defaults to `GET,HEAD,POST` — unlike Express's `cors`, which allows the full set — so `PATCH` and `DELETE` fail their preflight while the endpoints themselves work. Not observable through `app.inject()`, which is why `apps/api/test/cors.test.ts` drives the preflight directly.

- **Every package is ESM** (`"type": "module"`). `apps/api` was CommonJS while the packages it imports were ESM, which made named imports across that boundary fail at runtime while type-checking fine.
- **TypeScript is pinned to 6.0.3** because `typescript-eslint` caps at `<6.1.0`. Bumping to 7 silently loses the boundary rules.
- **Prisma 7 has no `datasourceUrl`** — build clients through `createPrismaClient()` in `packages/db`, which uses a driver adapter. Connection URLs live in `prisma.config.ts`, not the schema.
- **`prisma migrate reset` drops the `public` schema**, taking Supabase's role grants with it. The `20260805154500_supabase_grants` migration restores them; if you ever see `42P01 relation does not exist` as `authenticated`, that is the cause — not RLS.
- **The generated Prisma client is gitignored.** `postinstall` regenerates it; CI does so explicitly before lint and typecheck.
- **`packages/db` has the `no-unsafe-*` rules disabled** because eslint cannot follow Prisma's runtime-built client class. `tsc` still checks those files.

**Never commit with `--no-verify` or `core.hooksPath=/dev/null`.** Run `pnpm format` and fix the failure instead; a bypassed gate is how CI ends up red. lint-staged runs `eslint --fix` _before_ prettier — that order matters, since eslint rewrites source.

## Non-negotiables

These are the rules that are cheap to follow and expensive to discover you broke.

1. **`userId` is a required parameter on every repository method.** Never read from ambient context. The worker uses the service-role key and bypasses RLS — this signature is what stops a cross-user leak. (`TECH-DESIGN.md` §2.1, §3.6)

2. **A new table ships with an RLS policy and an RLS test.** Prove user A cannot read or write user B's rows. A table without one is an incomplete migration.

3. **`packages/core` is the single implementation of domain math.** Scoring, decay, calibration, FSRS, friction classification, temper bands. The API and the SPA import the same functions — if a gauge and the API disagree about a score, the product's central promise is broken. Never reimplement, never approximate.

4. **Capture paths must stay ≤5s and ≤2 taps.** Focus start/stop, friction logging, progress updates. If a change makes one slower, it's wrong regardless of what else it improves.

   **These paths are mobile-first**: ≥44px touch targets, primary actions in the thumb zone at the bottom, `dvh` not `vh`, safe-area insets respected. The command palette is the desktop surface only — mobile gets a bottom sheet with the same action registry. Test at 375px. (`TECH-DESIGN.md` §5.1)

5. **Files are canonical for teach workspaces; Postgres is a rebuildable index.** Never make the DB authoritative. Running `/teach` locally against a workspace must keep working.

6. **Sync conflicts are surfaced, never resolved silently.** Retain both versions. Losing a lesson is unacceptable.

7. **Lesson HTML is untrusted.** Separate origin, `sandbox="allow-scripts"` **without** `allow-same-origin`, `connect-src 'none'`. Never relax this to make something work.

8. **No live API calls in automated tests.** Recorded fixtures, stubbed clients. CI is free and offline-safe.

9. **Cost tracking ships with the first LLM call**, not after. Every model call writes an `llm_calls` row.

10. **Honesty over encouragement.** No fake celebration, no inflated scores, no hidden decay. If a change makes a number look better without the underlying thing being better, it's a bug.

## Architecture rules

**Backend** (`apps/api`, DDD + Clean Architecture — `TECH-DESIGN.md` §2.1)

- Layers: `domain/` ← `application/` ← `{infrastructure/, presentation/}`. Domain imports nothing but itself and `packages/core`.
- Prisma lives only in `infrastructure/persistence/`. Domain and application never import `@prisma/client`.
- The worker calls the API's use cases; it does not reimplement writes.
- Add layers when there's an invariant to protect. CRUD-ish modules stay thin — the ceremony is not the point.

**Frontend** (`apps/web`, feature-sliced — `TECH-DESIGN.md` §2.2)

- Server state lives in TanStack Query and is never copied into `useState`.
- Components never fetch. Requests go through hooks in `features/<x>/api/`.
- Features never import each other. Cross-feature goes through `shared/` or route composition.
- Routes are smart, components are dumb.
- Don't port the backend's four layers into React. Query _is_ the data layer.

## Testing

Unit + integration + E2E, **80% global floor enforced in CI**, `packages/core` at 100%. Full policy in `TECH-DESIGN.md` §13.

- A bug fix starts with a failing test.
- Test the agent on shape (files created, records parse), never on generated content.
- Flaky tests are bugs: quarantine in a day, fix in a week.

## Conventions

- **TypeScript strict**, no `any` without a comment explaining why.
- **Zod schemas live in `packages/core`** and are shared by API validation, SPA forms, and LLM structured outputs. One definition, three consumers.
- **Timestamps are `timestamptz`.** Every "day", "week", and scheduled job derives from the user's IANA timezone, never server-local.
- **No hardcoded user-facing strings.** en + pt-BR, `react-i18next` with ICU. Enum values are keys; the UI translates at render. Format dates, numbers, and durations with `Intl` or a `packages/core` helper — never by hand. UI locale, timezone, and _content language_ (what the agent writes lessons in) are three separate settings. (`TECH-DESIGN.md` §5.2)
- **Money and tokens** — store token counts as integers, cost as `numeric`, never float.
- **Commits** reference the requirement ID where one applies: `feat(friction): one-tap logging (FR-C1, FR-C2)`.

## Anthropic API notes

- Default model `claude-opus-5`. Thinking is on by default; control depth with `output_config.effort`, not by disabling it.
- `temperature` / `top_p` / `top_k` and assistant prefills are rejected — use structured outputs (`output_config.format`).
- Stream anything over ~16K `max_tokens`.
- Prompt caching is a prefix match: system prompts stay frozen per purpose, dynamic content goes after the last breakpoint. Assert on `cache_read_input_tokens` in dev.
- The `teach` agent runs via `@anthropic-ai/claude-agent-sdk` — a different package from `@anthropic-ai/sdk`. Don't confuse them.

## Don't

- Don't add gamification, streaks-with-punishment, or celebratory copy. It corrupts the data the product exists to collect.
- Don't hardcode the product name — it lives in one config constant.
- Don't reach for a third state manager. Query, `useState`, and two Zustand stores is the whole budget.
- Don't run the full test suite in pre-commit. It belongs at pre-push and CI.
