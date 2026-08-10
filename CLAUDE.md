# CLAUDE.md

Mindforge — an agent-taught curriculum with honest tracking. One flow, nothing else:
**curriculum → modules → lessons → progress · time · frequency.**

## The shape of a mission

A mission is a **main topic**. Under it sit **tracks** — subtopics, ordered fundamentals-first —
and a track's lessons are its **module**. `CURRICULUM.md` is canonical for the structure, the
`curriculum` skill writes it, and lessons are generated one at a time by a skill built on the
upstream `teach` skill (Matt Pocock's). Mindforge orchestrates the teaching; it never reimplements
it.

Four things about it that are easy to get wrong:

1. **A module is a track. There is no separate entity.** One module per subtopic, always, so a
   second table would be two names for one row.
2. **A lesson declares its own track**, in `<meta name="mindforge:track">`. Never from
   `CURRICULUM.md` — the agent rewrites index files wholesale, and a membership with two homes
   eventually disagrees with itself.
3. **`tracks.position` is a plan, not the truth.** Hard sequencing comes from `track_edges` and,
   between lessons, from `lesson_edges`. `lessons.position` is the same kind of plan, one level down.
4. **Module progress is a real fraction** — completed over every lesson the module now has, planned
   or written. A module with no lessons at all returns null and renders as "not planned yet", never
   as a zero.

## Read first

| Doc                                    | For                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`NORTHSTAR.md`](./NORTHSTAR.md)       | The destination, the principles, which milestone we're on — and §5, the list of everything cut      |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | What to build. Requirements are referenced by ID (FR-K2, FR-T3…) — use those IDs in commits and PRs |
| [`TECH-DESIGN.md`](./TECH-DESIGN.md)   | How to build it: architecture, schema, the teach pipeline, testing                                  |

Don't restate these docs here. When something changes, update the doc, not this file.

## Status

**v0.2 refocus (2026-08-10).** The product was cut down to the one flow above. Deleted wholesale —
docs, code, and tables in the same change (`20260810120000_refocus_curriculum_flow`): goals, skills
and scoring, the resource library, notes, friction/ember-slag, weekly planning and reviews,
notifications and nudges, the tasks orphan, and the roadmap's SRS/assessments/galaxy/insights
milestones. `NORTHSTAR.md` §5 records what left and what would bring each back. The cut code is one
git revert away.

Two consequences of the refocus worth knowing when reading older comments:

- **`RESOURCES.md` is a workspace file only** (FR-K4). The agent still maintains it for grounding
  and it still syncs to Storage, but nothing parses it into the app — there is no resources table.
- **The briefing shrank to what is real**: mission, curriculum position, learning records' `Next`,
  and a typed `NotTracked` for lesson outcomes until the reader ships. Skills and friction sections
  are gone with their features.

**M3 — the teach pipeline — works end to end.** Press "Teach me the next thing" on a mission and: a
run queues, the dispatcher claims it, a briefing is rendered from what Mindforge actually knows, the
agent runs with the `teach` skill loaded and `Bash` genuinely withheld, the workspace syncs to
Storage with conflict retention, the files are parsed into `lessons`, `reference_docs` and
`learning_records`, and `llm_calls` reconciles to the run's real bill. A real run: 26 turns,
8 minutes, **$1.47**.

**M4 — the curriculum — is code-complete and unproven by a real run** (`NORTHSTAR.md` §4).
`CURRICULUM.md` now plans lessons, not just tracks: a `## Module: <slug>` table per track carrying
slug, title, intent, difficulty 1–5, depth and depends-on, parsed into planned `lessons` and
`lesson_edges` (migration `20260810160000_planned_lessons`, design in `TECH-DESIGN.md` §3.2b). The
briefing names the next unblocked planned lesson and the generated file claims that row back with
`<meta name="mindforge:lesson">`; `/v1/missions/:id/curriculum` and the curriculum screen render the
plan with its locks, fractions and fundamental counts, all derived in `packages/core`.

**Curricula are authored from a terminal, deliberately.** Nothing in the app dispatches a
`generate_curriculum` run: the endpoint always queues `generate_lesson`, and the worker always loads
the `teach` plugin — `writeCurriculumPlugin` is built and tested with no caller. You write a
curriculum by running `/curriculum` in the mission's workspace; the next teach run syncs the file and
the reindexer picks it up from there. The curriculum screen's empty state names that command rather
than offering a button, because the teach button queues a _lesson_ and the `teach` skill is told
`CURRICULUM.md` is an input it must never write.

That is a decision, not an oversight — but it means `NORTHSTAR.md` M4's done-when ("press one button
on a fresh mission") is not met, and §7's open question, whether the agent plans good lesson lists up
front, still needs one real curriculum run to answer. Closing the gap later is three changes: infer
the run kind from whether the mission has tracks, pick the plugin from `run.kind` in the dispatch
gateway, and swap the empty state's command for the button.

Three things about the plan that are easy to get wrong when changing it:

- **A planned lesson and the file written from it are one row**, claimed by slug. The unique index
  on `(mission_id, slug)` is **partial** — planned rows only — so the slug is released as the row
  flips, and two written lessons may still share a filename slug.
- **The file owns what a lesson is; the plan owns why it is there.** A regeneration may revise a
  written lesson's intent, difficulty, depth and position, and may never touch its title, module or
  content.
- **Pruning is per module.** A planned row dropped from a module the parse contained is deleted; a
  module the parse never reached is left alone, because a run that stopped halfway has decided
  nothing about it.

`pnpm dev` gives you a sign-in screen, then four screens: **Today** (the focus timer),
**Missions** (cards with the teach button), **Insights** (the activity grid), and **Settings**
(profile, learner memory, changelog). ⌘K opens the command palette anywhere and reads its list from
the same route table the nav does. A fifth screen, **the curriculum** (`/missions/$missionId`), is
reached from a mission card rather than the nav — it belongs to a mission, and a nav item would have
to guess which one.

`pnpm --filter @mindforge/db seed:rich` gives you six months of history for `dev@mindforge.local` /
`mindforge-dev` — two curricula with modules in every state, lessons in three outcome states, seven
lessons planned and not yet written (so the curriculum screen has locks and a next lesson to show),
~90 sessions shaped so every derived signal fires (never a Saturday, one dead fortnight, a parked
mission). `seed:report` prints what the tracker functions actually say about it. Use it before
designing anything that reads `daily_activity` or module progress.

Deferred deliberately, still: **Railway is not provisioned** and there is no cloud Supabase project
(the org is at its 2-project free limit; local is sufficient until M6's deploy). **SSE is not
built** — the mission card polls every five seconds while a run is live; `EventSource` cannot send
an `Authorization` header, so the endpoint arrives as a `fetch`-parsed stream, and
`features/teach/api/use-teach.ts` is where the swap happens.

Three ideas run through everything, and they are the ones to preserve when changing anything:

1. **"Unknown" is never rendered as zero.** A module with no plan, a range never rolled up — each
   returns null with a reason, and the UI says which. A 0% bar is a claim that something was
   measured.
2. **Derived numbers are computed on read, never stored.** Module progress, unblocked lessons,
   fundamental badges, active days. `daily_activity` is the one narrow exemption: a cache, never
   authoritative, rebuildable from raw rows at any moment.
3. **Files are canonical; Postgres is a rebuildable index.** The teach workspace must always work
   from a terminal without Mindforge.

## Getting started

```sh
supabase start                                # local Postgres + Auth + Storage
pnpm install                                  # postinstall runs prisma generate
pnpm --filter @mindforge/db exec prisma migrate deploy
pnpm dev                                      # api on :3000, web on :5173
```

`.env.local` holds the local connection strings and is gitignored; `packages/db/.env` is a copy the
Prisma CLI reads. `.env.example` documents the shape.

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
pnpm --filter @mindforge/web test:e2e          # Playwright (needs supabase start)
pnpm --filter @mindforge/db generate           # regenerate the Prisma client
```

## Environment facts that bite

- **`prisma migrate dev` cannot run here at all.** The `profiles.id → auth.users.id` foreign key is
  a cross-schema reference, and Prisma refuses to introspect past it unless `auth` is listed in the
  datasource's `schemas` — which would hand Prisma ownership of tables Supabase owns. Write the
  migration by hand, apply it with `migrate deploy`, and prove it with the RLS and integration
  suites. Everything hand-written into a migration is invisible to `schema.prisma` and will not be
  regenerated: every CHECK constraint and partial unique index exists only in SQL.

- **`packages/db` owns the `daily_activity` rollup**, not the worker. It has three callers that
  cannot otherwise share code — the nightly job, `seed:rich`, and any manual rebuild — and the
  worker cannot import `apps/api`. It is delete-then-insert over a range on purpose: a session
  deleted since the last run has to make its day go _down_, and an upsert can only ever revise a
  day upwards.

- **There is no Redis anywhere** — not locally, not in CI, not in `supabase/config.toml`. `bullmq`
  and `@nestjs/bullmq` are declared by both server apps and imported by nothing. The scheduler is a
  self-rescheduling `setTimeout` in `apps/worker`, and its timer is also the only thing holding the
  event loop open. Idempotency lives in Postgres — the `daily_activity` range rebuild and the
  `agent_runs` single-active-run partial index — so the swap to a queue stays local when Redis
  arrives.

- **Runtimes are not uniform.** `apps/lessons` runs on Bun (pure I/O, no Prisma, no Nest, isolated
  by design); everything else is Node 22.

- **Workspace packages are dual-entry.** `@mindforge/core|db|llm|workspace` export `src/*.ts` under
  the `development` condition and `dist/` otherwise. `dev` passes `--conditions=development`, so
  editing a package needs no rebuild; `build` and `typecheck` read `dist`, which is why `turbo`
  declares them `dependsOn: ["^build"]`. Running `tsc --noEmit` in one app directly, without
  building packages first, reports the packages as missing — use `pnpm typecheck`.

- **Nest apps run through `@swc-node/register`, not `nest start`.** SWC is the only fast transpiler
  that emits `emitDecoratorMetadata`, which Nest's DI needs; esbuild and tsx silently do not, and
  every class-typed constructor parameter then fails to resolve. Both apps declare `typescript`
  explicitly — the loader once resolved two different major versions and crashed.

- **`tsBuildInfoFile` lives inside `dist/`** in every `tsconfig.build.json`. With it at the package
  root, `rm -rf dist` leaves tsc believing everything is current: the next build prints nothing,
  exits 0, emits no JS, and the failure surfaces much later as a missing module at runtime.

- **The architectural boundary rules need `boundaries/root-path` and a TypeScript import resolver,
  or they silently enforce nothing.** `pnpm check:boundaries` asserts violations are still
  reported — run it after touching `eslint.config.mjs`. `*.module.ts` is exempt: a composition root
  cannot bind an abstraction without naming the implementation.

- **`pnpm lint` runs `eslint .`, not `eslint src`.** Test directories are lint-checked too, which
  is where the `new Date()` ban matters most — an integration test that reaches for the wall clock
  is a test that fails at midnight.

- **The web dev server uses `strictPort`.** The API's CORS allow-list is exactly `APP_ORIGIN`, so a
  silent move to 5174 turns every request into a preflight failure whose message names the _origin_
  rather than the port.

- **CORS methods are listed explicitly.** `@fastify/cors` defaults to `GET,HEAD,POST`, so `PATCH`
  and `DELETE` fail their preflight while the endpoints work. Not observable through
  `app.inject()`, which is why `apps/api/test/cors.test.ts` drives the preflight directly.

- **`apps/web/src/shared/ui` is the component library**, one component per file, each importing its
  own stylesheet. Features compose it and never write a raw `mf-*` class. `Button` deliberately
  does not accept `className`: a one-off style has to become a variant. Assert on `data-variant`,
  never on class names.

- **Every package is ESM** (`"type": "module"`). **TypeScript is pinned to 6.0.3** because
  `typescript-eslint` caps at `<6.1.0` — bumping to 7 silently loses the boundary rules.
  **Prisma 7 has no `datasourceUrl`** — build clients through `createPrismaClient()` in
  `packages/db`. **`prisma migrate reset` drops the `public` schema**, taking Supabase's role
  grants with it; the `20260805154500_supabase_grants` migration restores them — `42P01` as
  `authenticated` means grants, not RLS. **The generated Prisma client is gitignored**;
  `postinstall` regenerates it.

- **E2E pins `locale: en-US` and `timezoneId: UTC`**, and that is load-bearing: a new account is
  seeded from the browser it signed up in, and two specs assert on which day things land. Known
  blind spot, recorded in `apps/web/e2e/README.md`: the suite cannot catch the sign-in form
  flashing while the stored session is read.

**Never commit with `--no-verify` or `core.hooksPath=/dev/null`.** Run `pnpm format` and fix the
failure instead. lint-staged runs `eslint --fix` _before_ prettier — that order matters, since
eslint rewrites source.

## Non-negotiables

1. **`userId` is a required parameter on every repository method.** Never read from ambient
   context. The worker uses the service-role key and bypasses RLS — this signature is what stops a
   cross-user leak. (`TECH-DESIGN.md` §2.1, §3.6)

2. **A new table ships with an RLS policy and an RLS test.** Prove user A cannot read or write user
   B's rows. A table without one is an incomplete migration.

3. **`packages/core` is the single implementation of domain math.** The calendar, the grid, module
   progress and the lesson-graph derivations (`curriculum/lesson-graph.ts`: fundamental, unblocked,
   next lesson). The API and the SPA import the same functions — never reimplement, never
   approximate.

4. **Capture paths stay ≤5s and ≤2 taps.** The focus timer and (in M5) the lesson outcome. Mobile
   first: ≥44px touch targets, thumb-zone actions, `dvh` not `vh`, test at 375px. (`TECH-DESIGN.md`
   §5.1)

5. **Files are canonical for teach workspaces; Postgres is a rebuildable index.** Running `/teach`
   locally against a workspace must keep working.

6. **Sync conflicts are surfaced, never resolved silently.** Retain both versions. Losing a lesson
   is unacceptable.

7. **Lesson HTML is untrusted.** Separate origin, `sandbox="allow-scripts"` **without**
   `allow-same-origin`, `connect-src 'none'`. Never relax this to make something work.

8. **No live API calls in automated tests.** Recorded fixtures, stubbed clients.

9. **Cost tracking ships with every LLM call.** Every model call writes an `llm_calls` row, and a
   run's rows sum to its `modelUsage`.

10. **Honesty over encouragement.** No fake celebration, no inflated progress, no hidden decay of
    any kind. If a change makes a number look better without the underlying thing being better,
    it's a bug.

## Architecture rules

**Backend** (`apps/api`, DDD + Clean Architecture — `TECH-DESIGN.md` §2.1)

- Layers: `domain/` ← `application/` ← `{infrastructure/, presentation/}`. Domain imports nothing
  but itself and `packages/core`.
- Prisma lives only in `infrastructure/persistence/`.
- The worker calls the API's use cases through `@mindforge/api`'s `exports` map
  (`apps/api/src/modules/teach/index.ts`); it does not reimplement writes. Two things would break
  that silently and are asserted by `apps/worker/test/api-module-boot.test.ts`.
- Add layers when there's an invariant to protect. CRUD-ish modules stay thin.

**Frontend** (`apps/web`, feature-sliced — `TECH-DESIGN.md` §2.2)

- Server state lives in TanStack Query and is never copied into `useState`.
- Components never fetch. Requests go through hooks in `features/<x>/api/`.
- Features never import each other. Cross-feature goes through `shared/` or route composition —
  `app/` holds the screen wrappers that hand one feature's UI to another as render props.
- Routes are smart, components are dumb. Query _is_ the data layer.

## Testing

Unit + integration + E2E, **80% global floor enforced in CI**, `packages/core` at 100% lines.
Full policy in `TECH-DESIGN.md` §13.

- A bug fix starts with a failing test.
- Test the agent on shape (files created, records parse), never on generated content.
- Flaky tests are bugs: quarantine in a day, fix in a week.
- Five gates run outside the suites, all in CI: `pnpm check:boundaries`, `pnpm check:i18n`, the
  coverage gates, the Supabase-backed integration/RLS job, and E2E.

## Conventions

- **TypeScript strict**, no `any` without a comment explaining why.
- **Zod schemas live in `packages/core`** and are shared by API validation and SPA forms.
- **Timestamps are `timestamptz`.** Every "day" and scheduled job derives from the user's IANA
  timezone, never server-local.
- **No hardcoded user-facing strings.** en + pt-BR, `react-i18next` with ICU; a missing key fails
  the build. Enum values are keys; the UI translates at render. UI locale, timezone, and content
  language are three separate settings. (`TECH-DESIGN.md` §5.2)
- **Money and tokens** — token counts as integers, cost as `numeric`, never float.
- **Commits** reference the requirement ID where one applies: `feat(teach): curriculum parser (FR-K2)`.

## Anthropic API notes

- Default model `claude-opus-5`. Thinking is on by default; control depth with
  `output_config.effort`, not by disabling it.
- `temperature` / `top_p` / `top_k` and assistant prefills are rejected — use structured outputs.
- Stream anything over ~16K `max_tokens`.
- Prompt caching is a prefix match: system prompts stay frozen per purpose, dynamic content goes
  after the last breakpoint. Assert on `cache_read_input_tokens` in dev.
- The `teach` agent runs via `@anthropic-ai/claude-agent-sdk` — a different package from
  `@anthropic-ai/sdk`. Don't confuse them.

## Two ways a teach run authenticates

`TEACH_AUTH=api_key` (default) bills API usage and is the only mode anything deployed can use — a
container has nobody logged in. `TEACH_AUTH=subscription` uses the Claude Code login on this machine
instead, which is what makes running lessons freely during a soak affordable.

Two things about it that are not obvious:

- **The key must be deleted from the subprocess environment, not merely left unset.** `options.env`
  is a spread of `process.env`, so a developer switching modes still has `ANTHROPIC_API_KEY` in
  `.env.local`, the CLI finds it, and the run bills API credits while every log line says
  "subscription". Caught by asserting on `system/init`'s `apiKeySource`.
- **Subscription mode gives up config isolation.** `CLAUDE_CONFIG_DIR` is what keeps a run from
  reading the host's `~/.claude`, and it is also where the login lives. One person on their own
  machine is fine; two users is not, which is the other reason `api_key` is the default.

## Agent SDK facts that bite

Verified against `0.3.222`'s own `sdk.d.ts`, and written down because each one fails _silently_ —
the run succeeds and does the wrong thing. Full detail in `TECH-DESIGN.md` §7.3.

- **`allowedTools` does not restrict tools.** It auto-approves them. Restriction is `tools` (base
  surface) + `disallowedTools` (removes the definition) + `permissionMode: "dontAsk"`. Assert on
  `system/init`'s `tools` array rather than trusting any of the three.
- **`Skill` is a tool and must be in `options.tools`.** A run without it loads the skill, lists it
  in `init.skills`, and can never invoke it — 12 turns of competent research, no lesson. The
  probe's two verdicts (did it invoke `Skill`, did a lesson appear) are what catch this.
- **`options.env` replaces the subprocess environment, it does not merge.** Spread `process.env` or
  the run loses `PATH`, `HOME`, and `ANTHROPIC_API_KEY`. (The Python SDK merges. This one doesn't.)
- **`query({ prompt, options })` takes one object and returns an async generator.** There is no
  awaited result and no `result.usage`.
- **A failing run yields its result message and then throws.** `SDKResultError` has no `result`
  field — branch on `subtype`. Persist inside the loop or in `finally`.
- **`settingSources: []` or the run inherits the host's `~/.claude`.**
- **A skill is not loaded by copying `SKILL.md` into `cwd`.** Use
  `plugins: [{ type: "local", path }]` and name the skill namespaced (`mindforge-teach:teach`).
  **A bad plugin path is skipped silently** — assert on `init.plugins` and `init.skills`.
- **The message stream is not the bill.** The SDK's own internal work was 22% of the probe run's
  cost and appears only in `modelUsage` — hence one `teach_turn` row per deduplicated message plus
  one `teach_overhead` row per model, summing to `modelUsage`.
- **The SDK does not expand `~`.** And the CLI binary ships as `optionalDependencies`, so
  `npm ci --omit=optional` produces an install that fails at the first `query()`.

## Supabase Storage facts that bite

- **There is no conditional write.** A `PUT` with a deliberately wrong `If-Match` returns `200` and
  overwrites — probed, not assumed. So the ETag detects a concurrent writer but cannot exclude one;
  what makes a teach run safe is the `agent_runs` single-active-run partial index plus
  `.conflict-<ts>` retention (§7.4). Retention, not locking.
- **The upload response carries no ETag.** Read it from `list()` (`metadata.eTag`) or `info()`.
- **`info().version` beats the ETag as a change token.** The ETag is `md5(content)`, so a
  byte-identical rewrite leaves it unchanged; `version` moves on every write.

## Don't

- Don't add gamification, streaks-with-punishment, or celebratory copy. It corrupts the data the
  product exists to collect.
- Don't add features outside the flow. `NORTHSTAR.md` §5 is the list of what was cut and what would
  bring each back — a new sidequest needs to argue with that table, not just be a good idea.
- Don't hardcode the product name — it lives in one config constant.
- Don't reach for a third state manager. Query, `useState`, and two Zustand stores is the whole
  budget.
- Don't run the full test suite in pre-commit. It belongs at pre-push and CI.
