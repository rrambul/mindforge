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

**Mindforge turns a topic into a curriculum, teaches it one hands-on lesson at a time, and reports
your progress without rounding it up.**

You give it a mission: a topic and the reason you want it. An agent plans a curriculum of modules,
fundamentals first, with every lesson named up front along with its difficulty, depth and
prerequisites. Lessons are written one at a time, when you ask for the next one. Each lesson is a
short explanation and an exercise you do. When you finish, you record how it went, and the next
lesson adjusts to that. Three trackers answer three questions without flattering you: how far
you've got, how much time you've put in, and how often you show up.

The whole product is one flow:

**curriculum → modules → lessons → progress · time · frequency**

## What a lesson is

A lesson explains as little as it can (the target is 800 words) and then gives you something to
do. The exercise sits in a panel beside the lesson and comes in three kinds:

- **Code** in JavaScript, TypeScript or Python. You write it in an editor, and the tests run in
  your browser, in a sandboxed frame on a separate origin. Python runs on Pyodide.
- **A whiteboard** for design questions. You draw on a canvas, and an AI reviewer checks the
  drawing against a rubric item by item. The rubric stays hidden until your first review, because
  seeing it first would show you the answer.
- **A task** for languages the browser can't run, such as Rust or Elixir. The panel gives you every
  file and the command to run on your own machine, and records what you report, labelled as your
  report.

When you are stuck on code, hints come in five rungs: a question, a clue, the concept, the shape of
a solution, and finally the code itself. You can't skip rungs, and the reference solution is behind
its own button. Opening it is recorded as the top rung of help.

**Lessons adapt.** Mindforge judges each finished lesson from what you did (attempts, hints, time)
next to the outcome you recorded. If a lesson was too hard, the next one is a smaller bridge toward
it, and the lesson you struggled with stays as it was. If two in a row were too easy, the next one
goes a step above the plan. Either way, the lesson says it was adjusted and why. A lesson you
couldn't pass also offers "Try an easier version".

**Lessons are edited for voice.** Every lesson ends with a pass of the
[humanizer](https://github.com/blader/humanizer) skill over its prose, which removes the patterns
that make generated text read as generated. If a run skips a skill it loaded, or leaves dashes the
pass should have removed, the run says so.

## What the numbers promise

The trackers are built to stay accurate when the news is bad.

- **Unknown is never shown as zero.** A module with no plan yet, or a range the nightly rollup
  hasn't reached, returns null with a reason, and the screen says which. A 0% bar would claim
  something was measured.
- **Progress is a fraction, never a percentage.** "3 of 5 lessons" describes the plan. A
  percentage of a plan that keeps changing reads as a measurement of you.
- **A bar that can't see everything says so.** Mission progress adds up only the modules that have
  a plan, and prints how many it left out. Counting an unplanned module as zero would make the bar
  fall every time the curriculum grew.
- **A shaky outcome stays shaky** until you redo the lesson. Nothing decays and nothing is quietly
  forgiven.
- **Time you didn't claim is labelled.** Minutes from a timer you started are `timer`. Minutes the
  reader counted while a lesson was open are `auto`. The lesson runs in a cross-origin frame, so the
  app can't tell reading from a tab you walked away from. It caps that measurement and keeps the two
  kinds separate.
- **A run reports only what it did.** It counts the lessons it wrote, and it lists problems by the
  file they are in, only for files it touched.
- **No streaks, no gamification, no celebration copy.** They would distort the data the product
  collects.

Two design rules hold the rest up:

- **Files are canonical, and Postgres is a rebuildable index.** A teach workspace is HTML and
  Markdown on disk. `/curriculum` and `/teach-me` in a terminal are a supported way to write one, so
  a workspace works without the app.
- **Derived numbers are computed when read, never stored.** That covers module progress, unblocked
  lessons, fundamental badges and active days. The one exception is the nightly `daily_activity`
  rollup, which is a cache that can be rebuilt from raw rows at any time.

## Status

**v0.2** narrowed the product to the flow above. Goals, skill scoring, the resource library, notes,
friction analytics, weekly planning, notifications, spaced repetition, assessments and the skill
galaxy were cut, with their code, docs and tables, in one change. `NORTHSTAR.md` §5 lists each of
them with the condition that would bring it back.

| Milestone                               | State                                                   |
| --------------------------------------- | ------------------------------------------------------- |
| M0 Foundations · M1 Capture · M2 Rhythm | built                                                   |
| M3 The teach pipeline                   | works end to end (a real run: 26 turns, 8 min, $1.47)   |
| M4 The curriculum                       | built, proven by real runs                              |
| M5 Lessons in the product               | built and proven end to end                             |
| Hands-on lessons (`PLAN-HANDS-ON.md`)   | built: exercises, hints, adaptation, whiteboard, Python |
| M6 The trackers, finished               | in progress; two of its jobs landed early               |

The first real walk through the loop produced 12 modules and 69 planned lessons in three minutes,
then wrote lesson 0001, which claimed its plan entry and rendered in the reader with its own
typography and two JavaScript components. That cost $2.50
over 37 calls, and it found three bugs the tests had missed, because the same hand had written the
tests, the seed and the code. A later mission on system design interviews planned 12 modules and
65 lessons in about four minutes; its lessons cost between $0.72 and $1.93 each.

Some things are not built yet, on purpose. Nothing is deployed: Railway isn't provisioned, there is
no cloud Supabase project, and local is enough until M6. There is no SSE either. The mission card
polls every five seconds while a run is live, because `EventSource` can't send an `Authorization`
header. `NORTHSTAR.md` M6 also records two known gaps in the trackers: today's activity doesn't
reach the grid until the nightly rollup runs, and a read under a minute counts for nothing.

## Getting started

You need Node 22, pnpm 10, Docker (for Supabase) and Bun (for the lessons origin).

```sh
supabase start                                # local Postgres + Auth + Storage
pnpm install                                  # postinstall runs prisma generate
pnpm --filter @mindforge/db exec prisma migrate deploy
pnpm dev                                      # api :3000, web :5173, lessons :3001
```

`.env.local` holds the local connection strings and is gitignored. `.env.example` documents every
setting. Four matter most:

- **`LESSONS_TOKEN_SECRET`** is required by both `api` and `lessons`, and has no development
  default. After the API has checked row-level security, this secret is the whole ownership check,
  and a default would be a secret in the repository shared by every deployment that forgot to set
  one. Both processes refuse to start without it. If one started anyway, it would answer 404 to
  every lesson, and the logs would look exactly like a learner whose content had gone missing.
- **`TEACH_AUTH`** chooses what a teach run bills. `api_key` (the default, and the only option for a
  deployment) bills API usage. `subscription` bills the Claude Code login on this machine, which is
  cheaper for local use. That login is whichever one `CLAUDE_CONFIG_DIR` points at in the shell that
  ran `pnpm dev`.
- **`ANTHROPIC_API_KEY`** is needed for hints and whiteboard reviews in either mode. Both are single
  API calls, and both count toward the daily budget.
- **`TEACH_DAILY_BUDGET_USD`** caps what one learner can spend on teaching per day, 15 by default.
  Empty means no cap, and `0` turns teaching off.

If the lessons service isn't running, every lesson renders as an empty frame. A deployment that
forgot to run it looks the same.

### Sample data

```sh
pnpm --filter @mindforge/db seed:rich   # dev@mindforge.local / mindforge-dev
pnpm --filter @mindforge/db seed:report # what the tracker functions say about it
```

This gives six months of history. It includes curricula with modules in every state, lessons in
all three outcome states, planned lessons not yet written (so the curriculum screen shows locks and
a next lesson), and about 90 sessions shaped so every derived signal fires. There is never a
Saturday session, there is one dead fortnight, and one mission is parked. The seed also writes the
files behind the rows, including one exercise of each kind, so the reader has real lessons to
serve. Run `seed:report` before designing anything that reads `daily_activity` or module progress.

## The app

The nav has four screens: **Today** (the focus timer), **Missions** (mission cards with the teach
button), **Insights** (the activity grid) and **Settings** (profile, learner memory, changelog).
⌘K opens a command palette built from the same route table as the nav.

Three more screens belong to a mission and open from its card: the **curriculum**
(`/missions/$missionId`), a **lesson** with its exercise panel (`…/lessons/$lessonId`), and the
**library** (`…/library`). They aren't in the nav because a nav item would have to guess which
mission you meant.

## Layout

```
apps/
  api        Nest + Fastify — DDD/Clean, the use cases and the REST surface   (Node)
  web        React + Vite — feature-sliced SPA, TanStack Query as data layer  (Node)
  worker     the scheduler and the teach-run dispatcher                       (Node)
  lessons    untrusted lesson HTML and the test runners, on their own origin  (Bun)
packages/
  core       domain math, Zod schemas — the single implementation, shared by API and SPA
  db         Prisma schema, hand-written migrations, RLS tests, the rollup
  llm        Anthropic client, hints and reviews, cost accounting
  workspace  the teach workspace: parse, sync, conflict retention
skills/      the skills a teach run loads, two of them vendored (see Licence)
```

Lesson HTML is untrusted. It is served from a separate origin, in a frame with
`sandbox="allow-scripts"` and **without** `allow-same-origin`, because with both a frame can delete
its own sandbox attribute. The code runners live on that origin too, each with its own
content-security policy, and only the Python runner may fetch anything (its own interpreter files).
None of this is relaxed to make something work.

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
pnpm --filter @mindforge/worker put:workspace -- --mission=<id> --from=<dir>  # write files into a workspace
```

## Testing

There are unit, integration and E2E tests, with an 80% global coverage floor enforced in CI and
100% line coverage for `packages/core`. A bug fix starts with a failing test. The agent is tested on
the shape of what it produces (the files exist, the records parse), never on the generated content,
and no automated test calls a live API.

Five gates run outside the suites, all in CI: `pnpm check:boundaries`, `pnpm check:i18n`, the
coverage gates, the Supabase-backed integration and RLS job, and E2E. `TECH-DESIGN.md` §13 has the
full policy.

## Docs

| Doc                                      | For                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| [`NORTHSTAR.md`](./NORTHSTAR.md)         | The destination, the principles, the current milestone, and §5, everything cut  |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md)   | What to build. Requirements carry IDs (FR-K2, FR-X7…) used in commits and PRs   |
| [`TECH-DESIGN.md`](./TECH-DESIGN.md)     | How it is built: architecture, schema, the teach pipeline, the runners, testing |
| [`PLAN-HANDS-ON.md`](./PLAN-HANDS-ON.md) | The hands-on lessons plan, and what changed from it while building              |
| [`CLAUDE.md`](./CLAUDE.md)               | The working agreement for agents, and the environment facts that cause trouble  |

## Licence

Mindforge is [MIT](./LICENSE), Copyright (c) 2026 Renan Rambul.

Two directories are other people's work, vendored verbatim with their own licences:

- `skills/teach/` is the `teach` skill from [`mattpocock/skills`](https://github.com/mattpocock/skills),
  MIT, Copyright (c) 2026 Matt Pocock ([`LICENSE`](./skills/teach/LICENSE)). Mindforge orchestrates
  it and never reimplements it.
- `skills/humanizer/` is the humanizer skill from
  [`blader/humanizer`](https://github.com/blader/humanizer), MIT, Copyright (c) 2025 Siqi Chen
  ([`LICENSE`](./skills/humanizer/LICENSE)).

Mindforge does not relicense either one. `skills/README.md` has the details.

This is a personal project. It is published to be read and reused under the licence above, but it
isn't accepting contributions. The design docs record decisions; they aren't an invitation to
reopen them.
