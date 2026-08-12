<!--
  The mark sits beside the wordmark here for the same reason `Brand` composes them that way in
  the app, and carries `alt=""` for the reason Logo.tsx gives: next to the name it is decorative,
  and a screen reader announcing "Mindforge Mindforge" is worse than silence.

  It points at the source SVG rather than a generated PNG, for two reasons. The raster icons are
  inset — 40% of the canvas is padding, so Android can crop them to a circle and iOS can round
  the corners — and they have the light `--mf-ground` plate baked in, which on a dark README reads
  as a pale tile around the anvil. The SVG is full-bleed, transparent, and already theme-aware:
  `.steel` flips fill under `prefers-color-scheme`, so the anvil is dark here and light steel on
  GitHub's dark theme. Raw serves it as `image/svg+xml` under a CSP of `style-src 'unsafe-inline'`,
  which is what lets that embedded stylesheet run.

  `align="middle"` rather than `valign`: GitHub's sanitizer keeps both, but only `align` is a real
  attribute on `img` — it maps to `vertical-align`, and `valign` would be inert decoration.
-->

# <img src="apps/web/public/favicon.svg" alt="" width="34" height="34" align="middle"> Mindforge

**Turns a topic into a curriculum, teaches it lesson by lesson, and tells you the truth about how
you're moving through it.**

You give it a mission — a topic and a why. An agent proposes a curriculum: modules ordered
fundamentals-first, every lesson named up front with a difficulty, a depth and its dependencies.
Lessons are then written one at a time, on demand. As you read them you record how each one landed,
and three trackers answer three questions without flattering you: how far, how much, how often.

One flow, no sidequests:

**curriculum → modules → lessons → progress · time · frequency**

## What makes it different

Most learning tools are built to make you feel good about using them. This one is built to be
worth trusting when the news is bad.

- **"Unknown" is never rendered as zero.** A module nobody has planned, a range never rolled up —
  each returns null with a reason, and the screen says which. A 0% bar is a claim that something
  was measured.
- **No percentages, anywhere.** Progress is a fraction — 3 of 5 lessons — because a percentage of a
  plan that gets revised reads as a measurement of you rather than of the plan.
- **A bar that can't see everything says so.** Mission progress sums only the modules that have a
  plan, and prints how many it skipped. Folding an unplanned module in as a zero would make the bar
  _fall_ every time the curriculum grew.
- **A _shaky_ outcome stays shaky** until you redo the lesson. No decay, no quiet forgiveness.
- **Time you didn't claim is labelled as such.** A timer you started is `timer`; minutes the reader
  counted while a lesson was open are `auto`. The lesson lives in a cross-origin frame, so the app
  genuinely cannot tell reading from a tab you walked away from — so it bounds the measurement
  instead of trusting it, and keeps the two populations separate forever.
- **No streaks, no gamification, no celebratory copy.** It would corrupt the data the product
  exists to collect.

Two structural commitments hold the rest up:

- **Files are canonical; Postgres is a rebuildable index.** A teach workspace is HTML and Markdown
  on disk. `/curriculum` and `/teach-me` in a terminal are a supported route, so the workspace works
  without the app at all.
- **Derived numbers are computed on read, never stored.** Module progress, unblocked lessons,
  fundamental badges, active days. The nightly `daily_activity` rollup is the single narrow
  exemption — a cache, never authoritative, rebuildable from raw rows.

## Status

**v0.2**, refocused onto the flow above. Nine feature pillars from v0.1 were cut — goals, skill
scoring, friction analytics, spaced repetition, assessments, a skill galaxy, integrations —
along with their code, docs and tables in a single change. `NORTHSTAR.md` §5 lists every one with
the condition that would bring it back.

| Milestone                               | State                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| M0 Foundations · M1 Capture · M2 Rhythm | built                                                 |
| M3 The teach pipeline                   | works end to end — a real run: 26 turns, 8 min, $1.47 |
| M4 The curriculum                       | code-complete, proven by one real run                 |
| M5 Lessons in the product               | built and proven end to end                           |
| M6 The trackers, finished               | in progress — two jobs landed early                   |

The loop has been walked once for real: a fresh mission produced 12 modules and 69 planned lessons
in three minutes, and a second press wrote lesson 0001, which claimed its plan entry and rendered in
the reader with its own typography and two JavaScript components. **$2.50, 37 calls.** It found
three bugs nothing else had, each hidden by the tests and the seed having been written by the same
hand as the code.

**Not built yet, deliberately:** no deploy (Railway unprovisioned, no cloud Supabase — local is
sufficient until M6), and no SSE (the mission card polls every five seconds while a run is live,
because `EventSource` cannot send an `Authorization` header). Two honest gaps in the trackers are
recorded in `NORTHSTAR.md` M6 rather than papered over: today's activity doesn't reach the grid
until the nightly rollup, and a read under a minute contributes nothing.

## Getting started

Requires Node 22, pnpm 10, Docker (for Supabase) and Bun (for the lessons origin).

```sh
supabase start                                # local Postgres + Auth + Storage
pnpm install                                  # postinstall runs prisma generate
pnpm --filter @mindforge/db exec prisma migrate deploy
pnpm dev                                      # api :3000, web :5173, lessons :3001
```

`.env.local` holds the local connection strings and is gitignored; `.env.example` documents the
shape. **`LESSONS_TOKEN_SECRET` is required by both `api` and `lessons` and has no development
default** — it is the whole of the ownership check once the API has done its RLS test, and a default
would be a secret in the repository that every deployment forgetting to set one would silently
share. Both processes refuse to boot without it. One that started anyway would answer 404 to every
lesson and look, in the logs, exactly like a learner whose content had gone missing.

Skip the third service and every lesson renders an empty frame — which is also what a deployment
that forgot it looks like.

### Sample data

```sh
pnpm --filter @mindforge/db seed:rich   # dev@mindforge.local / mindforge-dev
pnpm --filter @mindforge/db seed:report # what the tracker functions actually say about it
```

Six months of history: two curricula with modules in every state, lessons in three outcome states,
seven planned-not-written lessons so the curriculum screen has locks and a next lesson, and ~90
sessions shaped so every derived signal fires — never a Saturday, one dead fortnight, a parked
mission. It also writes the files behind those rows, so the reader has real lesson HTML to serve.
Run `seed:report` before designing anything that reads `daily_activity` or module progress.

## The app

Four screens on the nav — **Today** (the focus timer), **Missions** (cards with the teach button),
**Insights** (the activity grid) and **Settings** (profile, learner memory, changelog). ⌘K opens a
command palette that reads its list from the same route table the nav does.

Three more belong to a mission rather than to the nav, and are reached from its card: the
**curriculum** (`/missions/$missionId`), a **lesson** (`…/lessons/$lessonId`) and the **library**
(`…/library`). A nav item for any of them would have to guess which mission you meant.

## Layout

```
apps/
  api        Nest + Fastify — DDD/Clean, the use cases and the REST surface   (Node)
  web        React + Vite — feature-sliced SPA, TanStack Query as data layer  (Node)
  worker     the scheduler and the teach-run dispatcher                       (Node)
  lessons    serves untrusted lesson HTML on its own origin                   (Bun)
packages/
  core       domain math, Zod schemas — the single implementation, shared by API and SPA
  db         Prisma schema, hand-written migrations, RLS tests, the rollup
  llm        Anthropic client, cost accounting
  workspace  the teach workspace: parse, sync, conflict retention
```

Lesson HTML is untrusted, so it is served from a separate origin in a frame with
`sandbox="allow-scripts"` and **without** `allow-same-origin` — together those two let a frame
delete its own sandbox attribute. That is never relaxed to make something work.

## Commands

```sh
pnpm dev             # all services (turbo)
pnpm build           # packages to dist, then the apps
pnpm typecheck       # tsc across the workspace — builds packages first
pnpm lint            # eslint, including the architectural boundary rules
pnpm test:coverage   # unit + the coverage gate
pnpm format          # prettier — run before committing

pnpm --filter @mindforge/api test:integration  # real Postgres + Auth (needs supabase start)
pnpm --filter @mindforge/db exec vitest run    # RLS tests (needs supabase start)
pnpm --filter @mindforge/web test:e2e          # Playwright (needs supabase start)
```

## Testing

Unit, integration and E2E, with an 80% global floor enforced in CI and `packages/core` at 100%
lines. A bug fix starts with a failing test. The agent is tested on shape — files created, records
parse — never on generated content, and no automated test makes a live API call.

Five gates run outside the suites, all in CI: `pnpm check:boundaries`, `pnpm check:i18n`, the
coverage gates, the Supabase-backed integration/RLS job, and E2E. Full policy in `TECH-DESIGN.md`
§13.

## Docs

| Doc                                    | For                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| [`NORTHSTAR.md`](./NORTHSTAR.md)       | The destination, the principles, the milestone we're on — and §5, everything cut |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | What to build. Requirements carry IDs (FR-K2, FR-T3…) used in commits and PRs    |
| [`TECH-DESIGN.md`](./TECH-DESIGN.md)   | How: architecture, schema, the teach pipeline, testing                           |
| [`CLAUDE.md`](./CLAUDE.md)             | Working agreement for agents, and the environment facts that bite                |

Personal project, private repo. Not accepting contributions.
