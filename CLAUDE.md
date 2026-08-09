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

**M3 — the workspace and the agent — the path exists end to end** (`NORTHSTAR.md` §4). Press "Teach
me the next thing" on a mission and: a run queues, the dispatcher claims it, a briefing is rendered
from what Mindforge actually knows, the agent runs with the `teach` skill loaded and `Bash` genuinely
withheld, the workspace syncs to Storage with conflict retention, the files are parsed into `lessons`,
`reference_docs` and `learning_records`, and `llm_calls` reconciles to the run's real bill.

**A real run has happened, and it works.** 26 turns, 8 minutes, **$1.47** — a 26KB lesson, a
reference card, a learning record, three shared assets, and a learner memory the agent wrote without
being asked. §16.2 is answered. What is left of the finish line is doing it through the app rather
than the probe, and confirming `/teach` still runs locally against the same workspace.

**The first attempt failed, and the cause is the one to remember: `Skill` is a tool.** `options.tools`
is the base surface, so a run without `Skill` in it loads the skill, lists it in `init.skills`, and
can never invoke it — 12 turns and $0.27 of competent resource research, no lesson. That is R1
arriving through the front door after the frontmatter guard had been taken off the back one. The
probe's two verdicts — did it invoke the Skill tool, did a lesson appear — are the only reason this
did not ship looking healthy.

**Day one was the whole point, and it moved the design twice.** §7.3 was a sketch that said so, and
verified against `sdk.d.ts` it was wrong in nine places. Two of them fail _silently_ — the run
succeeds and does the wrong thing:

1. **`allowedTools` does not restrict tools**, it auto-approves them. The sketch listed six and
   commented "No Bash: the agent has no business running shell commands here". Bash was never
   withheld. Restriction needs `tools` + `disallowedTools` + `permissionMode` together, and the only
   real proof is asserting on `system/init`'s own tool list.
2. **Supabase Storage has no conditional write.** A `PUT` carrying a deliberately wrong `If-Match`
   returns 200 and overwrites — probed, not assumed. So the ETag detects a concurrent writer and
   cannot exclude one, and what makes a run safe is the single-active-run index plus
   `.conflict-<ts>` retention. Retention, not locking.

**The probe found something reading the types could not: the message stream is not the bill.** A
one-turn run reported two models in `modelUsage` and one in the assistant stream, and the invisible
one — the SDK's own internal work — was 22% of the cost. Counting assistant messages would have
understated every cost figure the product reports, by more as the agent leans on subagents. So a run
writes one `teach_turn` row per deduplicated message _and_ one `teach_overhead` row per model for the
residual, and the invariant is that a run's `llm_calls` sum to its `modelUsage`.

**Three tables' worth of columns finally got writers, and one of them was wrong.**
`missions.workspace_key` has existed since M0 with a comment saying it is set once so a rename cannot
move files, and nothing ever wrote it — the same shape as M2's defect below. It was also globally
unique, which meant the first account to claim `rust` took it from everyone and the 409 told the
second person that somebody else had a mission by that name. Now unique per user.

**§2.1 decision 2 stopped being aspirational.** "The worker calls the API's use cases; it does not
reimplement writes" was false for two milestones: `apps/api` declared no `exports` map, so
`@mindforge/api` resolved to nothing while `missions.module.ts` carried a dead `exports:` line saying
otherwise. The worker now imports `TeachRuns` and binds a service-role `UserScopedDb` to the same
token — which is exactly what `shared/persistence/user-scoped-db.ts` predicted in M2. Two things
would have broken it silently and are now asserted by `apps/worker/test/api-module-boot.test.ts`:
both apps declare a `CLOCK` symbol and `Symbol("Clock") !== Symbol("Clock")`, and importing
`SharedModule` would make a process serving no HTTP demand `SUPABASE_URL`.

**Two corrections to the design that came from building it**, both in the reindexer:
`## History` is deliberately **not** parsed into `mission_revisions` — §7.4's parser table says it
should be, but `applyEdit` already diffs `MISSION_CONTENT_FIELDS`, the section does not shrink, and
there is no unique constraint, so three runs would have tripled a ledger the product reads as a drift
signal. And the reindexer **upserts** where `workspace_files` correctly delete-then-inserts, because
`lessons.completed_at` and `outcome` come from the M4 reader and are in no file: delete-then-insert
would throw away "somebody read this lesson" on every subsequent run.

**`RESOURCES.md` indexes into the library**, and its upsert key is normalised URL first, normalised
title second. `resources` has no natural unique constraint and the agent rewrites the file wholesale
every run, so this is the difference between a library and a library that doubles. The columns the
file does _not_ represent — `status`, `progress`, `finished_at`, `abandon_reason` — are not
expressible in the writer's interface at all, because the file has no status column and the column
defaults to `inbox`: a naive write resets a book you marked finished, on every run, forever.

Still deferred, and named rather than forgotten: **SSE is not built.** `EventSource` cannot send an
`Authorization` header, the guard reads the token from nowhere else, and the SPA sends
`credentials: "omit"` — so the mission card polls every five seconds while a run is live, and only
then. The endpoint arrives as a `fetch`-parsed stream; `features/teach/api/use-teach.ts` is where the
swap happens. **Per-user learner memory (§7.6) works end to end**: mounted read-write at `.memory/` for every run
from its own Storage prefix, indexed into `learner_memories`, and reviewable on Settings. Three rules
are enforced where they cannot be forgotten — the agent may not delete a memory (supersede, never
mutate), a run cannot mark its own inference as `confirmed_at`, and deleting one deletes the file too,
because a row-only delete is undone by the next run's reindex. There is no create endpoint and no
create button: §7.6 is explicit that an onboarding questionnaire is the wrong answer.

---

**M2 — the weekly rhythm — feature-complete.** Every bullet on M2's list is built, tested, and behind
the gates, along with two carryovers it could not be built honestly without: the seed scripts (an M0
bullet) and a settings write path.

**What M2 still needs is you doing three weekly reviews.** Its finish line is "you've done three
weekly reviews and changed one thing because of one" — `weekly_reviews.changed_one_thing` is a
column precisely so that is observable rather than remembered. Like M1's, it is not a coding task.

One bullet was reported done before it was, which is worth recording because the mistake is easy to
repeat: **"notes on anything"** (line 125) reads "one tap from a running session, **or from any
resource, skill, or mission**". The session half shipped, the API and schema accepted all eleven
subject types, the integration tests exercised them — and there was no way to reach any of them from
the UI. The schema being ready looked like the feature being done. FR-N1 calls `standalone` the escape
hatch for the genuinely unfiled thought, and it had become the only path the UI offered.

**The same shape produced M2's worst defect, and it is the one to remember.** `focus_sessions` has had
`mission_id` and `skill_id` since M0; the plan grid, plan-vs-actual and the review screen were each
correct and each proven by their own tests — and _neither capture path wrote either column_. So a user
could allocate two hours to a mission, log both, and read `0 min`. Every layer green, the path absent.
A column existing is not evidence that anything writes it, and a suite of correct layers is not
evidence of a working feature. `apps/web/e2e/weekly-rhythm.spec.ts` exists because that is the only
level the gap was visible from.

Three narrower cases of the same thing came out of the review, all fixed: the offline queue's
IndexedDB key was a constant, so signing out with unsent captures and signing in as somebody else
replayed them into the new account — cleanly, because every capture endpoint is an idempotent upsert.
`defaultWeekStartsOn` sat in `packages/core` with tests and no callers, because the only thing that can
create a profile is a trigger on `auth.users` and a trigger cannot see a browser; every account
therefore started on UTC and Monday whoever it belonged to. And an insights integration test booted a
probe module with `enableCors` inlined, so its ETag and CORS assertions checked the test against
itself.

M1's own finish line — ten real focus sessions logged without opening the code — was never reached;
M2 was started ahead of its three-week soak (sequencing rule 1), knowingly. That decision is worth
remembering if the capture loop turns out not to stick, because nothing downstream fixes it.

`pnpm dev` gives you a sign-in screen, then eight screens: Today, Missions, Goals, Skills, Notes,
Library, Insights, and Settings — plus `/weeks/<date>` and `/weeks/<date>/review`. M3 adds no screen
of its own: teaching happens from a mission card, because a mission is what a lesson is grounded in
and a separate "Teach" page would be a place to go rather than a thing to press. **Every screen has a URL now**: M2 introduced the TanStack Router tree that
`App.tsx` and `AppShell.tsx` had each been deferring in a comment since M1. ⌘K opens the command
palette anywhere, and reads its list from the same route table the nav does — that list used to be
written three times, so widening one put a screen in the bar and left it out of the palette.

`pnpm --filter @mindforge/db seed:rich` gives you six months of history for `dev@mindforge.local` /
`mindforge-dev`, shaped so every derived signal fires at least once; `seed:report` prints what the
`packages/core` functions actually say about it. Use it before designing anything that reads
`daily_activity` — a fixture where every insight is null is the one shape that proves nothing.

What shipped, in the order it was built: the server message bundle, the API request foundation (auth
guard, RFC 7807 errors, Zod validation, RLS-scoped access), **missions** (WIP limit of 3, revision
history, park), the **capture loop** (focus timer with intention → stop → ≤30s debrief, manual and
retroactive entry, one-tap typed friction with the ranked four, the ember/slag split), the **offline
queue**, **notes on anything** with Postgres full-text search — one tap from a running session and
from any resource, skill, or mission card — **resources** with URL capture, **goals** with typed
targets, **skills** with a prerequisite DAG and the calibration gap, the **command palette**, and the
**guided first mission**.

Then M2, in the order it was built: the **schema** (weekly plans and allocations, weekly reviews,
`daily_activity`, notifications), the **weekly-rhythm maths** in `packages/core` (timezone-aware
calendar, the real ember/slag rule, plan-vs-actual, backlog health, the activity grid, stall
detection), the **seed scripts and the rollup**, the **worker** (nightly rollup, stall detection, the
weekly-review reminder), the **planning**, **insights** and **account** API modules, the **route
tree**, **versioning and the changelog**, and the four screens: the weekly plan, the weekly review,
Insights, and Settings.

Three things M2 found by building rather than by reading, each of which had been sitting there:

1. **`prisma migrate dev` has never worked in this repo.** The `profiles.id → auth.users.id` foreign
   key is a cross-schema reference and Prisma refuses to introspect past it unless `auth` joins the
   datasource's `schemas`, which would hand Prisma ownership of tables Supabase owns. Every migration
   after the first is hand-written; that is the workflow, not a shortcut.
2. **The worker never booted.** Its `@swc-node/register` resolved TypeScript 7 while the API's
   resolved 5.9 — neither the pinned 6.0.3 — and the loader crashed reading `ts.Extension.Js`.
   Invisible because turbo's `dev` task is persistent, so it showed as one restart line in the TUI.
   Both apps now declare `typescript` explicitly.
3. **`GET /v1/health` reported `0.0.0 / dev / none`.** All three fields read env vars nothing set,
   so the endpoint whose entire job is answering "which code and which schema is running" had been
   answering it with placeholders since M0.

**Cross-feature composition lives in `app/`, and there are now nine wrappers doing it**:
`TodayScreen`, `GoalsScreen`, `MissionsScreen`, `SkillsScreen`, `ResourcesScreen`, `WeekScreen`,
`WeekReviewScreen`, `InsightsScreen`, `SettingsScreen`, plus `SubjectNote` and `CommandActions`.
`MissionsScreen` now hands a card two render props rather than one — a note composer and the teach
panel — for the same reason it handed it the first. §2.2 rule 6 forbids a feature importing another, so a resource card cannot reach
for the notes composer — the screen that composes both hands it in through a `renderNote` prop. That is
the rule working as intended rather than ceremony: the alternative is `features/resources` importing
`features/notes`, which is the first step toward the 40-file refactor the boundary exists to prevent.

Which links exist, and at which layer, is worth knowing before promising one:
`resource_links.skill_id` and `friction_events.skill_id`/`resource_id` are **columns with no
milestone** — the M0 schema was written for the whole product, so a column existing is not evidence
that anything plans to write it. §3.7 also draws a hard line: notes are hub-and-spoke, and
**no backlinks, no wikilinks, no graph view** is a decision, not an omission.

Three ideas run through all of it, and they are the ones to preserve when changing anything:

1. **"Unknown" is never rendered as zero.** A book of unknown length, a skill with no evidence, a goal
   whose targets cannot be measured yet — each returns null with a reason, and the UI says which. A 0%
   bar is a claim that something was measured.
2. **Derived numbers are computed on read, never stored.** Goal progress, skill bands, faded scores. A
   stored copy is a value that was true once, and `packages/core` exists so the API and the SPA cannot
   disagree about it.
3. **Self-report and evidence never touch.** `perceived_level` has its own column, its own endpoint,
   and no path to `score`. The gap between them is FR-S5, and it only means something while that
   holds.

**One interim proxy remains in the friction maths, and this note used to name two.** The ember/slag
split no longer weights each event as one minute — M2 replaced that with the session's own length
divided by intensity (`packages/core/src/friction/split.ts`, `TECH-DESIGN.md` §9.3b). What is left is
`producedLearning`, which reads the session's debrief. That one was recorded as expiring "in M2/M5"
and the M2 half never could: §9.3 defines it in terms of learning records and passed reviews, and
neither exists until M4/M5. It expires in M5, once.

Deferred deliberately: **Railway is not provisioned** — deploying an empty skeleton costs money and
shows a blank page. **No cloud Supabase project** either, since the org is at its 2-project free
limit and local is sufficient until deploy. Both of which is why `GET /v1/health` reports `dev` for
its commit: nothing builds a container, so nothing sets `GIT_SHA`.

**E2E exists now, and is the level most likely to be believed before it is written.** `@playwright/test`
was installed for the whole of M1 with no config and no specs — `pnpm test:e2e` crashed, nothing ran it,
and `apps/web/vitest.config.ts` excluded 378 lines (`App.tsx`, `providers.tsx`, `SignInForm`,
`use-supabase-session`) on the stated grounds that Playwright covered them. Sign up → sign in → sign out
was untested at every level. `apps/web/e2e/` now covers that flow, M2's weekly rhythm, and the signup
seeding, and CI runs all three; the other six flows §13.2 names are listed in `apps/web/e2e/README.md`
so the gap stays a list rather than a surprise.

The config pins `locale: en-US` and `timezoneId: UTC`, and that is load-bearing rather than tidy: a new
account is seeded from the browser it signed up in, Playwright otherwise uses the machine's own locale
and zone, and two specs assert on which week a session lands in. A suite about days and weeks cannot be
calibrated by the machine running it.

One blind spot is written down there rather than claimed: the suite proves a session survives a reload,
but **not** that the sign-in form does not flash while the stored session is read — `toBeVisible` retries
until things settle. Verified by breaking the `sessionKnown` guard and watching the suite stay green. It
does discriminate on what it claims: breaking `signOut()` fails four of `auth.spec.ts`'s six.

Five gates run outside the test suites, all wired into CI: `pnpm check:boundaries` (the architecture
rules actually fire), `pnpm check:i18n` (FR-L7), the per-package coverage gates, a second
CI job that boots the local Supabase stack so the **integration and RLS suites gate too** (with the
integration coverage thresholds actually enforced — CI ran the variant without `--coverage`, so two
configs each pointed at the other and nothing measured either), and the **E2E suite**.

Three M0/M1 claims turned out not to hold, all fixed:

- **`withRls` isolated nothing.** It set `request.jwt.claims` but Prisma connects as `postgres`, which
  owns the tables — policies never applied, and every query returned every user's rows. Replaced by
  `runAsUser`, which also switches role. FR-A3 rested entirely on this.
- **No Nest app could boot.** Workspace packages exported raw `.ts`, so Node choked on `export type`.
  Nobody found it because M0's finish line was a deployed URL and deployment was deferred.
- **`pnpm lint` only linted `src`.** Every package's script was `eslint src`, so test directories —
  including 2,000-odd lines of integration tests — were checked by the commit hook and never by CI.

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

- **`prisma migrate dev` cannot run here at all.** The `profiles.id → auth.users.id` foreign key is a
  cross-schema reference, and Prisma refuses to introspect past it unless `auth` is listed in the
  datasource's `schemas` — which would hand Prisma ownership of tables Supabase owns. Write the
  migration by hand, apply it with `migrate deploy`, and prove it with the RLS and integration
  suites. Everything hand-written into a migration is invisible to `schema.prisma` and will not be
  regenerated: the `notes.search` tsvector, every CHECK constraint, and `weekly_allocations`' two
  partial unique indexes exist only in SQL.

- **`packages/db` owns the `daily_activity` rollup**, not the worker. It has three callers that
  cannot otherwise share code — the nightly job, `seed:rich`, and any manual rebuild — and the worker
  cannot import `apps/api`. The domain maths it needs comes from `packages/core`; only the query
  lives there. It is delete-then-insert over a range on purpose: a session deleted since the last run
  has to make its day go _down_, and an upsert can only ever revise a day upwards.

- **`daily_activity` is a cache, never authoritative**, which is the narrow exemption to "derived
  numbers are computed on read". Nothing decides anything from it, nothing else writes it, and it
  rebuilds from raw rows at any moment.

- **There is no Redis anywhere** — not locally, not in CI, not in `supabase/config.toml`, not on
  Railway. `bullmq` and `@nestjs/bullmq` are declared by both `apps/api` and `apps/worker` and
  imported by nothing. The scheduler is a self-rescheduling `setTimeout` in `apps/worker`, and its
  timer is also the only thing holding the event loop open. Idempotency lives in Postgres — a
  `daily_activity` range rebuild and a unique `(user_id, dedupe_key)` on notifications — so the swap
  to a queue stays local when Redis arrives.

- **Runtimes are not uniform.** `apps/lessons` runs on Bun (pure I/O, no Prisma, no Nest, isolated by design); everything else is Node 22.

- **Workspace packages are dual-entry.** `@mindforge/core|db|llm` export `src/*.ts` under the `development` condition and `dist/` otherwise. `dev` passes `--conditions=development`, so editing a package needs no rebuild; `build` and `typecheck` read `dist`, which is why `turbo` declares them `dependsOn: ["^build"]`. Running `tsc --noEmit` in one app directly, without building packages first, reports the packages as missing — use `pnpm typecheck`.

- **Nest apps run through `@swc-node/register`, not `nest start`.** SWC is the only fast transpiler that emits `emitDecoratorMetadata`, which Nest's DI needs; esbuild and tsx silently do not, and every class-typed constructor parameter then fails to resolve. `pnpm build` + `pnpm start` runs plain compiled JS with no loader.

- **`tsBuildInfoFile` lives inside `dist/`** in every `tsconfig.build.json`. With it at the package root, `rm -rf dist` leaves tsc believing everything is current: the next build prints nothing, exits 0, emits no JS, and the failure surfaces much later as a missing module at runtime.

- **The architectural boundary rules need `boundaries/root-path` and a TypeScript import resolver, or they silently enforce nothing.** Lint runs per package, so patterns are matched relative to the package dir unless root-path is anchored; and TS's ESM convention (`./foo.js` for `foo.ts`) is unresolvable to the default node resolver, which classifies every internal import as unknown and leaves the rule with nothing to check. `pnpm check:boundaries` asserts violations are still reported — run it after touching `eslint.config.mjs`.

- **`*.module.ts` is exempt from the boundary rule.** A Nest module's job is binding abstractions to implementations, which cannot be written without naming the implementation (TECH-DESIGN.md §2.1's own example does it). The exemption is scoped to that filename; a controller importing a repository is still an error.

- **`pnpm lint` runs `eslint .`, not `eslint src`.** Test directories are lint-checked too, which is
  where the `new Date()` ban actually matters most — an integration test that reaches for the wall clock
  is a test that fails at midnight. It was `eslint src` for the whole of M1, so nothing under
  `apps/api/test/` was ever checked by CI.

- **The web dev server uses `strictPort`.** Vite's default is to increment to the next free port, and the port is load-bearing: the API's CORS allow-list is exactly `APP_ORIGIN`, so a silent move to 5174 turns every request into a preflight failure whose message names the _origin_ rather than the port. `Port 5173 is in use` is a diagnosis; a wall of CORS errors is a puzzle.

- **CORS methods are listed explicitly.** `@fastify/cors` defaults to `GET,HEAD,POST` — unlike Express's `cors`, which allows the full set — so `PATCH` and `DELETE` fail their preflight while the endpoints themselves work. Not observable through `app.inject()`, which is why `apps/api/test/cors.test.ts` drives the preflight directly.

- **`apps/web/src/shared/ui` is the component library, one component per file, each importing its own stylesheet from `shared/ui/styles/`.** Features compose it and never write a raw `mf-*` class — the only files that do are the three that own their own layout role (`AppShell`, `RunningSession`, `FrictionChips`'s sheet). `Button` deliberately does not accept `className`: a one-off style has to become a variant, which is what keeps the library from turning into a junk drawer (§2.2 rule 7). Anything used by exactly one feature stays in that feature's `ui/`.

- **Assert on `data-variant`, not on class names.** A class assertion pins the stylesheet rather than the behaviour, and broke the moment `Card` grew a variant API without its rendering changing at all.

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

## Agent SDK facts that bite

Verified against `0.3.222`'s own `sdk.d.ts` on M3 day one, and written down because each one fails
_silently_ — the run succeeds and does the wrong thing. Full detail in `TECH-DESIGN.md` §7.3.

- **`allowedTools` does not restrict tools.** It auto-approves them. A tool left out of the list is
  still in the model's context and still callable. Restriction is `tools` (base surface) +
  `disallowedTools` (removes the definition) + `permissionMode: "dontAsk"`. Assert on `system/init`'s
  `tools` array rather than trusting any of the three.
- **`options.env` replaces the subprocess environment, it does not merge.** Spread `process.env` or
  the run loses `PATH`, `HOME`, and `ANTHROPIC_API_KEY`. (The Python SDK merges. This one doesn't.)
- **`query({ prompt, options })` takes one object and returns an async generator.** There is no
  awaited result and no `result.usage`.
- **A failing run yields its result message and then throws.** `SDKResultError` has no `result`
  field — branch on `subtype`. Anything written after the `for await` never runs on a failure path,
  so persist inside the loop or in `finally`.
- **`settingSources: []` or the run inherits the host's `~/.claude`** — settings, `CLAUDE.md`, and
  user skills. On a dev machine that is your own config leaking into a user's lesson.
- **A skill is not loaded by copying `SKILL.md` into `cwd`.** Discovery needs `.claude/skills/` in
  cwd or an ancestor _and_ `settingSources` including `user`/`project`, which multi-tenant isolation
  forbids. Use `plugins: [{ type: "local", path }]`, and name the skill namespaced
  (`mindforge-teach:teach`). **A bad plugin path is skipped silently** — assert on `init.plugins` and
  `init.skills` or a run with no skill looks exactly like a run with one.
- **The SDK does not expand `~`.** And the CLI binary ships as `optionalDependencies`, so
  `npm ci --omit=optional` produces an install that fails at the first `query()`, not at install.

## Supabase Storage facts that bite

- **There is no conditional write.** A `PUT` with a deliberately wrong `If-Match` returns `200` and
  overwrites — probed against `storage-api v1.60.4`. Conditional _reads_ work (`If-None-Match` → 304).
  So ETag comparison detects a concurrent writer but cannot exclude one; what makes a teach run safe is
  the `agent_runs` single-active-run partial index plus `.conflict-<ts>` retention (§7.4).
- **The upload response carries no ETag.** Read it from `list()` (`metadata.eTag`) or `info()`, both
  of which are also the only way to get it — `download()` returns a `Blob` and discards headers.
- **`info().version` beats the ETag as a change token.** The ETag is `md5(content)`, so a
  byte-identical rewrite leaves it unchanged; `version` moves on every write.

## Don't

- Don't add gamification, streaks-with-punishment, or celebratory copy. It corrupts the data the product exists to collect.
- Don't hardcode the product name — it lives in one config constant.
- Don't reach for a third state manager. Query, `useState`, and two Zustand stores is the whole budget.
- Don't run the full test suite in pre-commit. It belongs at pre-push and CI.
