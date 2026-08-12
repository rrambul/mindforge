# Mindforge — Technical Design

**Status:** v0.2 — refocused on the curriculum flow
**Date:** 2026-08-10
**Companion doc:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) — product requirements. Read that first; this document assumes its vocabulary (Mission, Curriculum, Module/Track, Lesson, Learning Record, Focus Session).

> **v0.2 refocus.** The product is one flow now — curriculum → modules → lessons → progress · time ·
> frequency — and this document was cut to match. Removed wholesale: goals, skills and scoring,
> the resource library, notes, friction tracking, weekly planning and reviews, spaced repetition,
> assessments, artifacts, notifications, and the analytics that read them. The v0.1 designs live in
> git history.

---

## 0. Decisions taken in this document

Three architectural forks were open after the requirements doc. Resolved as follows — each is reversible, and the reasoning is stated so you can overturn it.

| Decision                           | Choice                                                        | Why                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hosting**                        | Supabase (Postgres + Auth + Storage) + Railway (API, worker)  | Your call. Good fit: RLS gives per-user isolation at the database, Railway gives long-running processes the agent needs.                                                                                                                  |
| **App shape**                      | Vite SPA + NestJS API                                         | Your call. Nest's modules map 1:1 onto the domain; DI makes the Anthropic and Supabase clients trivially mockable; `@nestjs/bullmq` gives the job queue the agent needs.                                                                  |
| **How `teach` runs**               | **Claude Agent SDK on a Railway worker**                      | `teach` is a file-based Claude Code skill. The Agent SDK is Claude Code packaged as a library — the `SKILL.md` runs unchanged, with the built-in Read/Write/Edit/Bash/Glob/Grep tools it already assumes. Alternatives evaluated in §7.1. |
| **Source of truth for workspaces** | **Files canonical in Supabase Storage; Postgres is an index** | Preserves round-tripping with local `/teach`, keeps the `teach` skill's contract intact, and makes the DB rebuildable from files. Trade-off: sync is the hardest part of the system (§7.4).                                               |
| **First milestone**                | **v0 capture loop, no AI**                                    | The riskiest assumption is "will you actually log anything", not "can we call an LLM". Schema and agent plumbing are designed here in full so v1 needs no rework.                                                                         |

---

## 1. System architecture

```
┌──────────────┐        ┌─────────────────────────────────────────────┐
│  Vite SPA    │        │  Railway                                     │
│  (React)     │        │  ┌────────────────┐    ┌──────────────────┐ │
│              │──HTTPS─┼─▶│  api (NestJS)  │───▶│ worker (NestJS)  │ │
│  Supabase JS │        │  │  REST + SSE    │◀───│ BullMQ consumer  │ │
│  (auth only) │        │  └───────┬────────┘    └────────┬─────────┘ │
└──────┬───────┘        │          │                       │           │
       │                │          │                  Agent SDK        │
       │                │          │                  (@anthropic-ai/  │
       │                │          │                   claude-agent-   │
       │                │          │                   sdk)            │
       │                └──────────┼───────────────────────┼───────────┘
       │                           │                       │
       │  JWT                      ▼                       ▼
       └──────────────▶ ┌──────────────────┐      ┌─────────────────┐
                        │    Supabase      │      │  Anthropic API  │
                        │  ┌────────────┐  │      │  claude-opus-5  │
                        │  │  Auth      │  │      │  claude-haiku   │
                        │  │  Postgres  │  │      └─────────────────┘
                        │  │  (+ RLS)   │  │
                        │  │  Storage   │◀─┼──── workspaces/<mission>/…
                        │  └────────────┘  │      (MISSION.md, lessons/, …)
                        └──────────────────┘

                        ┌──────────────────┐
                        │  lessons origin  │  separate hostname, serves
                        │  (Railway svc)   │  lesson HTML sandboxed (§7.5)
                        └──────────────────┘

                        ┌──────────────────┐
                        │  Redis (Railway) │  BullMQ queues
                        └──────────────────┘
```

**Four deployables** on Railway: `api`, `worker`, `lessons` (static-ish file server on its own hostname), and Redis. The SPA is static — host it on Railway too, or any CDN.

`worker` is a separate service, not a thread in `api`, for three reasons: agent runs take minutes and would tie up request handlers; it needs a writable ephemeral filesystem the API shouldn't have; and it scales on a completely different axis (one long job at a time vs. many short requests).

---

## 2. Stack

| Layer          | Choice                                                                          | Notes                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | Vite + React + TypeScript                                                       | React over Lit here: the chart/dashboard ecosystem (Recharts/visx) and TanStack Query matter more than shadow-DOM encapsulation for a single-app product.                                                                                       |
| Routing / data | TanStack Router + TanStack Query                                                | Query's cache + optimistic mutations are what make ≤5s capture actually feel instant.                                                                                                                                                           |
| UI             | Tailwind + Radix primitives                                                     | Headless primitives, own the visual design (see `REQUIREMENTS.md` §7.6 — this app needs to feel calm, not templated).                                                                                                                           |
| Charts         | Recharts (little charting left; the grid is hand-rolled CSS)                    |                                                                                                                                                                                                                                                 |
| API            | NestJS + Fastify adapter                                                        | Fastify over Express for throughput and better schema integration.                                                                                                                                                                              |
| Validation     | Zod, shared via `packages/core`                                                 | One schema per DTO, reused for API validation, SPA forms, and LLM structured outputs.                                                                                                                                                           |
| DB access      | Prisma ORM                                                                      | Mature migrations, strong TS inference, and the schema doubles as documentation. RLS needs an explicit transaction wrapper — `runAsUser` (§3.6). A Prisma Client extension looks like the right shape here and isolates nothing; §3.6 says why. |
| Queue          | **None.** A self-rescheduling `setTimeout` in `worker`; idempotency in Postgres | BullMQ + Redis was the plan and is still the destination — see §10. It is not what runs. `bullmq` and `@nestjs/bullmq` are declared by both server apps and imported by nothing.                                                                |
| Auth           | Supabase Auth (email+password, GitHub OAuth)                                    | SPA holds the session; API verifies the JWT.                                                                                                                                                                                                    |
| DB / Storage   | Supabase Postgres + Storage                                                     | RLS on every table. Storage holds teach workspaces.                                                                                                                                                                                             |
| LLM            | `@anthropic-ai/sdk` (API calls), `@anthropic-ai/claude-agent-sdk` (teach agent) | Two different packages, two different jobs — see §7.1.                                                                                                                                                                                          |
| Observability  | Pino → Railway logs; Sentry; a `llm_calls` table for cost                       |                                                                                                                                                                                                                                                 |
| Tests          | Vitest (unit + integration), Playwright (E2E)                                   | Matches the patterns you already use.                                                                                                                                                                                                           |

### Repo layout

```
mindforge/
├─ apps/
│  ├─ web/                 Vite SPA
│  ├─ api/                 NestJS HTTP API        — DDD + Clean Architecture (§2.1)
│  ├─ worker/              NestJS standalone      — BullMQ consumers, Agent SDK
│  └─ lessons/             Tiny Fastify service: serves workspace files, own origin
├─ packages/
│  ├─ core/                Pure calculation shared by api, worker, and web
│  ├─ db/                  Prisma schema, migrations, RLS policies
│  └─ llm/                 Anthropic client wrappers, prompt builders, output schemas
├─ REQUIREMENTS.md
├─ TECH-DESIGN.md
└─ NORTHSTAR.md
```

---

## 2.1 Backend architecture — DDD + Clean Architecture

`apps/api` is organised as feature modules, each with four layers:

```
apps/api/src/modules/<feature>/
├─ domain/
│  ├─ entities/                 rich objects; invariants enforced in constructors
│  ├─ value-objects/            Score, TemperBand, FrictionType, Minutes
│  ├─ events/                   domain events (SkillEvidenceRecorded, MissionParked)
│  └─ <feature>.repository.ts   interface + Symbol token
├─ application/
│  ├─ commands/                 one write use case per file
│  ├─ queries/                  one read use case per file
│  ├─ ports/                    outbound interfaces (clock, storage, llm, queue)
│  └─ dto/                      Zod-derived request/response shapes
├─ infrastructure/
│  ├─ persistence/              repository impl + mappers (entity ↔ row)
│  └─ adapters/                 Anthropic, Supabase Storage, BullMQ producers
└─ presentation/
   ├─ <feature>.controller.ts
   └─ <feature>.module.ts       binds tokens → implementations
```

**Dependency rule:** `domain ← application ← {infrastructure, presentation}`. Domain imports nothing but itself and `packages/core`. Enforced with an ESLint boundary rule, not convention.

**Modules:** `missions` · `focus` · `teach` · `insights` · `account`.

### Token + wiring convention

```ts
// domain/focus-session.repository.ts
export const FOCUS_SESSION_REPOSITORY = Symbol("FocusSessionRepository");

export interface FocusSessionRepository {
  findById(userId: UserId, id: SessionId): Promise<FocusSession | null>;
  findRunning(userId: UserId): Promise<FocusSession | null>;
  save(userId: UserId, session: FocusSession): Promise<void>;
}
```

```ts
// presentation/focus.module.ts
@Module({
  controllers: [FocusController],
  providers: [
    FocusSessionCommands,
    { provide: FOCUS_SESSION_REPOSITORY, useClass: PrismaFocusSessionRepository },
  ],
  exports: [FocusSessionCommands], // the worker imports these
})
export class FocusModule {}
```

### Three decisions this structure forces, all of them good here

**1. `userId` is a required parameter on every repository method.** Not read from an ambient context. This is the structural fix for the risk flagged in §3.6 — the worker bypasses RLS because it uses the service-role key, and with this signature it _cannot_ forget to scope a query. The type system enforces what a code-review checklist otherwise has to.

**2. The worker reuses the API's use cases.** `apps/worker` imports feature modules and calls the same `application/commands/*` classes rather than reimplementing writes against the database. A BullMQ processor becomes a thin adapter: deserialize job → call use case → record result. Business rules live in exactly one place.

**3. LLM and Storage are ports, not imports.** `application/ports/lesson-generator.port.ts` and `storage.port.ts` are interfaces; the Anthropic and Supabase clients are infrastructure adapters behind them. Use cases are then testable without network access, which matters a lot for the agent path.

### Where `packages/core` fits

`packages/core` is **pure calculation with no domain identity** — the calendar maths, the activity
grid, the dependency-graph helpers, the module-progress derivations. It's a package rather than a
domain service because `apps/web` needs the same functions to render a fraction or a grid cell
without a round trip.

Domain entities _call_ `packages/core`; they don't duplicate it.

### Pragmatism

Not every module earns four layers. **Add layers when there's an invariant to protect, not by
default.** The modules that genuinely need the full structure are `teach` (workspace sync, conflict
handling, the run state machine) and `focus` (the session lifecycle). Applying the full ceremony to
every module turns a good pattern into overhead.

> **ORM:** Prisma, matching the reference structure. It's confined to `infrastructure/persistence/` — domain and application layers never import `@prisma/client`, and mappers convert rows to entities at the boundary. The one place Prisma needs care is RLS (§3.6).

---

## 2.2 Frontend architecture — feature-sliced

**Don't port the four backend layers into React.** Repositories and use-case classes in the browser are ceremony: TanStack Query _is_ the data layer, and the domain logic already exists in `packages/core`. What the SPA needs is strict boundaries around three things — where data enters, where it's derived, and where it's rendered.

```
apps/web/src/
├─ app/
│  ├─ router.tsx              route tree, guards, error boundaries
│  ├─ providers.tsx           Query client, auth, theme, command palette
│  └─ main.tsx
├─ features/<feature>/
│  ├─ api/                    query + mutation hooks — the ONLY place requests happen
│  ├─ model/                  derived selectors, form schemas, feature-local state
│  ├─ ui/                     components belonging to this feature
│  └─ routes/                 route components: fetch, compose, hand down props
├─ shared/
│  ├─ ui/                     design system: Button, Field, TemperGauge, RatioBar
│  ├─ lib/                    formatters, hooks, offline queue
│  └─ api/                    http client, auth interceptor, error mapping
└─ styles/tokens.css          the identity tokens, one source
```

**Modules mirror the backend's** — `missions`, `focus`, `teach`, `insights`, `settings` — so a change usually lands in one folder on each side.

### The rules that keep it clean

**1. Server state lives in TanStack Query and is never copied into `useState`.** This is the single biggest cause of unmaintainable React apps: the same data in two places, drifting. If it came from the API, it stays in the query cache; components read it with a hook.

**2. Components never fetch.** Every request goes through a hook in `features/<x>/api/`. A component that imports the http client directly is a bug.

**3. Types and validation come from `packages/core`.** The same Zod schemas the API validates with. No hand-written DTOs, no drift between client and server.

**4. Domain math comes from `packages/core` too.** The activity grid buckets days with the identical function the API answers with. If the grid and the API ever disagree about a number, the product's core promise is broken — so there is exactly one implementation.

**5. Routes are smart, components are dumb.** Route components fetch and compose; everything in `ui/` takes props and renders. Makes the UI layer trivially testable and storybook-able.

**6. Features never import each other.** Cross-feature sharing goes through `shared/`, or is composed at the route level. This is the boundary that stops a 40-file refactor two years in — enforce it with the same ESLint rule as the backend.

**7. `shared/ui` is the design system, not a junk drawer.** Something used once lives in that feature's `ui/`.

### Client state that isn't server state

Very little, and it doesn't need Redux. **Zustand** for two genuinely global, ephemeral concerns:

- **The running focus session** — tick, elapsed, current intention. Global because the timer must survive navigation and be visible from anywhere.
- **The command palette** — open state, and the action registry each feature contributes to.

Everything else is either server state (Query) or local component state (`useState`). If you find yourself reaching for a third store, the data probably belongs in Query.

### Forms

`react-hook-form` + `@hookform/resolvers/zod`, with schemas imported from `packages/core`. The
mission editor and the session debrief are the only real forms — most capture is one tap and
shouldn't be a form at all.

### Offline queue

Lives in `shared/lib/offline-queue.ts`, not in any feature. It wraps the timer's mutations,
persists to IndexedDB with client-generated UUIDs, and replays on reconnect. Idempotency is the
server's job — the client just retries.

### Testing

| Layer              | Tool                     | What                                            |
| ------------------ | ------------------------ | ----------------------------------------------- |
| `shared/ui`        | Vitest + Testing Library | Rendering, states, a11y.                        |
| `features/*/api`   | Vitest + MSW             | Query keys, optimistic rollback, error mapping. |
| `features/*/model` | Vitest                   | Pure selectors and derivations.                 |
| Routes             | Playwright               | The capture loop end to end.                    |

---

## 3. Data model

Postgres. Every user-owned table carries `user_id uuid not null references auth.users(id)` and has RLS enabled. Timestamps are `timestamptz`. IDs are `uuid default gen_random_uuid()`.

### 3.1 Core entities

````sql
-- Missions --------------------------------------------------------------
create table missions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  topic         text not null,
  why           text,
  success_looks_like text,
  constraints   text,
  current_level text,
  status        text not null default 'active'
                check (status in ('active','parked','completed','abandoned')),
  workspace_key text unique,          -- Storage prefix: workspaces/<user>/<slug>/
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Mission history is append-only: why the mission changed, and when.
create table mission_revisions (
  id         uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  user_id    uuid not null,
  changed_at timestamptz not null default now(),
  reason     text not null,
  snapshot   jsonb not null            -- full mission fields at that point
);

### 3.2 The curriculum: tracks and lessons

```sql
-- A subtopic — the module its lessons belong to. Display text ("module") is a
-- glossary concern (§5.2), not a second table.
-- A subtopic. M7 calls this an "arm"; it arrives at M4 because a module of
-- lessons is a track's lessons, and one entity is enough for both. Display text
-- ("subtopic") is a glossary concern (§5.2), not a second table.
create table tracks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  mission_id  uuid not null references missions(id) on delete cascade,
  slug        text not null,            -- stable; what a lesson's <meta> names
  name        text not null,
  outcome     text,                     -- one line: what you can do afterwards
  -- The recommended reading order, fundamentals first. A plan — hard
  -- sequencing comes from track_edges.
  position    integer not null,
  status      text not null default 'proposed'
              check (status in ('proposed','active','done','dropped')),
  created_at  timestamptz not null default now(),
  unique (mission_id, slug)
);

-- Prerequisites between tracks. Cycle check in app code — a DB constraint
-- cannot express a DAG.
create table track_edges (
  user_id   uuid not null,
  track_id  uuid not null references tracks(id) on delete cascade,
  prereq_id uuid not null references tracks(id) on delete cascade,
  primary key (track_id, prereq_id),
  check (track_id <> prereq_id)
);

-- Index over workspace files. Rebuildable — files in Storage are canonical.
create table lessons (-- Index over workspace files. Rebuildable — files in Storage are canonical.
create table lessons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  mission_id   uuid not null references missions(id) on delete cascade,
  -- From the lesson's own <meta name="mindforge:track">, never from an index
  -- file: the agent rewrites index files wholesale (see RESOURCES.md, §7.4), and
  -- a membership recorded in two places eventually disagrees. Null is legal —
  -- lessons predating the curriculum, and lessons taught off-plan.
  track_id     uuid references tracks(id) on delete set null,
  seq          integer not null,        -- 0001, 0002 … from the filename, mission-global
  slug         text not null,
  title        text not null,
  storage_path text not null,           -- RELATIVE to the workspace: lessons/0007-x.html
  content_hash text not null,
  completed_at timestamptz,
  outcome      text check (outcome in ('understood','shaky','lost')),
  unique (mission_id, seq)
);

create table reference_docs (create table reference_docs (           -- teach's ./reference/*.html (FR-T5)
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  mission_id   uuid not null references missions(id) on delete cascade,
  title        text not null,
  storage_path text not null,
  content_hash text not null,
  updated_at   timestamptz not null default now()
);

-- Mirrors teach's LEARNING-RECORD-FORMAT.md exactly. Append-only.
create table learning_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  mission_id   uuid not null references missions(id) on delete cascade,
  seq          integer not null,
  title        text not null,
  lesson_id    uuid references lessons(id) on delete set null,
  what_learned text not null,
  evidence     text,
  key_insight  text,
  storage_path text not null,
  struggles    text,
  next         text,                    -- feeds the briefing's what-next section
  supersedes_id uuid references learning_records(id),
  recorded_at  timestamptz not null default now(),
  unique (mission_id, seq)
);
````

### 3.2b The planned-lesson model (M4 — migrated in `20260810160000_planned_lessons`)

The refocused flow needed three things the M3 schema did not have, and they arrived **with the
parser and UI that write and read them** — a column nothing writes has burned this project twice
(`focus_sessions.mission_id` in M2, `missions.workspace_key` in M3).

```sql
alter table lessons add column status text not null default 'generated'
  check (status in ('planned','generated'));   -- a planned lesson has no file yet
alter table lessons add column intent text;     -- one line, from CURRICULUM.md
alter table lessons add column difficulty smallint
  check (difficulty is null or difficulty between 1 and 5);  -- how hard, for YOU (FR-K2)
alter table lessons add column depth text
  check (depth is null or depth in ('overview','working','deep_dive'));  -- how far down (FR-K2)
alter table lessons add column position smallint;  -- the plan's row order in its module

-- A planned lesson has no file, so the three columns describing one become
-- nullable — and stay effectively NOT NULL for anything generated.
alter table lessons alter column seq          drop not null;
alter table lessons alter column storage_path drop not null;
alter table lessons alter column content_hash drop not null;

alter table lessons add constraint lessons_generated_has_file
  check (status <> 'generated'
         or (seq is not null and storage_path is not null and content_hash is not null));
alter table lessons add constraint lessons_planned_has_no_file
  check (status <> 'planned'
         or (seq is null and storage_path is null and content_hash is null));
-- A lesson nobody can open cannot have been understood (non-negotiable 10).
alter table lessons add constraint lessons_planned_not_completed
  check (status <> 'planned' or (completed_at is null and outcome is null));

-- Partial, and that is the design: the plan owns each slug once per mission, and
-- hands it over the moment a generated lesson claims it.
create unique index lessons_planned_slug_key
  on lessons(mission_id, slug) where status = 'planned';
create index lessons_track_id_position_idx on lessons(track_id, position);

-- "A depends on B". Read forward it locks A until B is completed; read backward
-- it makes B fundamental for A. One edge, both readings (FR-K6, FR-K7).
create table lesson_edges (
  user_id   uuid not null,
  lesson_id uuid not null references lessons(id) on delete cascade,
  prereq_id uuid not null references lessons(id) on delete cascade,
  primary key (lesson_id, prereq_id),
  check (lesson_id <> prereq_id)
);
create index lesson_edges_user_id_prereq_id_idx on lesson_edges(user_id, prereq_id);
```

Six rules that carry the design:

1. **Planned lessons are rows without files.** `CURRICULUM.md` gained a per-module lesson table
   (slug, title, intent, difficulty, depth, depends-on); the reindexer upserts them as
   `status = 'planned'` with no `storage_path`. Generation attaches the file and flips the status —
   the generated lesson claims its plan entry via `<meta name="mindforge:lesson">`.
2. **One row, two lives — never two rows joined.** The claimed plan entry _is_ the lesson row, so
   `lessons.slug` is the plan's identity and `lessons_planned_slug_key` enforces it. It is
   **partial** so the slug is released as the row flips: two written lessons may legitimately share
   a filename slug (`0003-recap.html`, `0011-recap.html`), and a total unique would fail the
   reindex of a workspace that has them. Generated rows keep `(mission_id, seq)` as their identity,
   unchanged.
3. **Module progress = completed / planned** (FR-P2), computed on read in `packages/core`. The
   denominator is every lesson row in the module — the plan as it now stands, plus anything taught
   off-plan — which is why it needs no "was this planned?" flag to stay honest. A module with no
   rows at all has no denominator and renders as unknown, never as 0%.
4. **`fundamental` and `unblocked` are derived, never stored.** A lesson with dependents is
   fundamental; a lesson whose prerequisites are all completed is unblocked. Both read off
   `lesson_edges` in `packages/core` (M4, beside the module-progress maths); the parser breaks
   cycles the way it already does for `track_edges`, and refuses an edge into a later module — a
   lesson locked behind work the plan puts after it would never unblock.
5. **`position` is a plan, exactly like `tracks.position`.** It is the row order the module table
   was written in: the display order and the tie-break, never the sequencing. FR-K7 sequences from
   `lesson_edges` and difficulty.
6. **"Next lesson"** is the first unblocked, incomplete planned lesson in module order, difficulty
   ascending within a module (FR-K7). The briefing names it; the agent still decides.

### 3.3 The time tracker

```sql
create table focus_sessions (create table focus_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  mission_id     uuid references missions(id) on delete set null,
  intention      text,                  -- "what does done look like?" (FR-F3)
  started_at     timestamptz not null,
  ended_at       timestamptz,
  planned_minutes integer,
  -- Debrief, ≤30s (FR-F3)
  hit_intention  text check (hit_intention in ('yes','partly','no')),
  focus_quality  smallint check (focus_quality between 1 and 5),
  energy         smallint check (energy between 1 and 5),
  note           text,
  entry_mode     text not null default 'timer',  -- timer | auto | manual | backfilled (FR-F2, FR-F5)
  created_at     timestamptz not null default now()
);

```

**Index note:** `focus_sessions` is the analytics hot path. Index `(user_id, started_at desc)`
and `(user_id, mission_id, started_at desc)`.

**`entry_mode` has no CHECK constraint, and this document claimed one until M5 was reviewed.** The
init migration wrote the column with a default and nothing else; the constraint existed only here.
Nobody noticed because the set is enforced twice in TypeScript anyway — `EntryModeSchema` on the way
in, and `narrow(row.entryMode, ENTRY_MODES, …)` on the way out of the repository, which is what makes
a hand-edited row degrade to `timer` rather than reach the SPA as an unmodelled string. Worth adding
when a migration next touches this table; worth knowing until then, because a CHECK in this file is
not a CHECK in the database.

**The four modes, and why `auto` is one of them (FR-F5).** `timer` ran live because you pressed
start; `auto` ran live because you opened a lesson; `manual` was entered for something you did today;
`backfilled` is older than that. The last two are decided by the server from the profile's timezone
and can never be sent by a client — `StartFocusSessionSchema` accepts only the two live modes, so a
running session cannot be labelled as something entered after the fact.

`auto` earns the distinction for FR-F2's reason taken one step further. Time the reader was open is
a weaker claim than time you declared you were focusing: nobody asserted it, and §7.5's isolation
means the app cannot see a scroll or a keystroke inside the lesson and genuinely does not know
whether you were reading or had walked away. Recorded as `timer` the two populations would be one,
and the distinction is not reconstructable later from rows that never kept it.

The bounds live in the client (`useAutoLessonSession`), because the browser is the only thing that
knows the reader is open:

- **A settle delay before starting.** Opening a lesson and going straight back is not a read. It also
  removes a duplicate in development, where React mounts, unmounts and remounts every effect.
- **A hidden tab ends the session**, after a grace period — a ⌘-Tab to check a definition should not
  chop one read into a dozen rows.
- **A cap ends it too**, because a tab you walked away from is indistinguishable from one you are
  reading, and the only honest answer to that is to stop counting.
- **It stops only the session it started**, held by id. A timer you started deliberately is never
  touched by it.
- **A stop is sequenced behind its own start.** Leaving immediately used to send the stop while the
  start was in flight: a 404 against a session that then existed and ran forever, so every later
  start answered 409. Sessions abandoned by a closed tab are reaped on the way back in instead, since
  `pagehide` cannot be relied on to finish a POST.

One consequence to state plainly: `elapsedMinutes` floors, so a read under a minute records zero
minutes and still leaves the day looking empty. Rounding it up would be the inflation non-negotiable
10 exists to forbid, so it stands.

**`focus_sessions.lesson_id` arrived in M5** (`20260810180000_focus_session_lesson`), with the
reader that writes it and not before, for the write-path reason §3.2b states. `on delete set null`,
like `mission_id`: the session is the expensive artifact and the binding is the cheap one, and a
deleted lesson must not take an hour of recorded attention with it.

Two invariants around it are the **application's**, not the schema's, and both were tried in SQL
first:

- **"A lesson binding implies a mission."** As `check (lesson_id is null or mission_id is not null)`
  it broke every mission delete with a 23514, including the one behind account deletion (FR-A4):
  dropping a mission clears the two columns through two separate referential actions, and a CHECK is
  evaluated per row update with no way to defer it — Postgres allows `deferrable` on unique, primary
  key, exclusion and foreign key constraints, never on a check.
- **"The lesson belongs to _that_ mission."** The natural expression is a composite foreign key over
  `(mission_id, lesson_id)`, and `match full` would have carried the first invariant with it. It
  cannot be used: `match full` forbids mixing null and non-null key values, and a session bound to a
  mission with no particular lesson is the ordinary case.

`ResolveSessionSubject` keeps both by construction — it reads the lesson and takes the mission from
it, so the reader sends one id and the pair comes back complete. Binding is optional and never asked
twice (FR-F3), which is also why there is no picker: the only thing that sets this is the timer
button inside the reader.

### 3.5 Operational tables

```sql
create table agent_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  mission_id  uuid references missions(id) on delete cascade,
  kind        text not null check (kind in
              ('generate_lesson','generate_curriculum','sync_workspace')),
  status      text not null default 'queued'
              check (status in ('queued','running','succeeded','failed','cancelled')),
  job_id      text,
  input       jsonb,
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz
);

create table llm_calls (               -- cost + cache-hit observability (§8.5)
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  agent_run_id  uuid references agent_runs(id) on delete set null,
  purpose       text not null,
  model         text not null,
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  cost_usd      numeric(10,6),
  latency_ms    integer,
  created_at    timestamptz not null default now()
);

-- Index over the per-user learner memory files; see §7.6. Files are canonical.
create table learner_memories (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  slug         text not null,          -- filename without extension
  kind         text not null check (kind in
               ('background','teaching_preference','learning_pattern','constraint')),
  summary      text not null,          -- one line, used for recall relevance
  storage_path text not null,          -- memory/<user_id>/<slug>.md
  content_hash text not null,
  written_by   text not null default 'agent' check (written_by in ('agent','user')),
  confirmed_at timestamptz,            -- user-reviewed → higher trust
  superseded_by uuid references learner_memories(id),
  updated_at   timestamptz not null default now(),
  unique (user_id, slug)
);

-- Daily rollup. Powers the activity grid (§3.9) and every dashboard that would
-- otherwise scan raw sessions. Rebuilt nightly per user timezone, over a trailing
-- window rather than yesterday alone — see the note below.
create table daily_activity (
  user_id          uuid not null,
  day              date not null,          -- in the user's timezone, not UTC
  focus_minutes    integer not null default 0,
  session_count    integer not null default 0,
  -- A stale grid and an empty grid look identical without this, and a nightly job is
  -- the thing most likely to fail quietly.
  rebuilt_at       timestamptz not null default now(),
  primary key (user_id, day)
);

create table workspace_files (create table workspace_files (         -- sync ledger; see §7.4
  user_id      uuid not null,
  mission_id   uuid not null references missions(id) on delete cascade,
  path         text not null,          -- relative: "lessons/0007-closures.html"
  content_hash text not null,          -- sha256 of bytes
  size_bytes   integer not null,
  storage_etag text,
  synced_at    timestamptz not null default now(),
  primary key (mission_id, path)
);
```

> **`daily_activity` and "derived numbers are never stored".** It is a stored derivation, and the
> exemption is narrow: it is a **cache**, never authoritative. Nothing decides anything from it,
> nothing writes it but the rollup, and it rebuilds from raw rows at any moment. The alternative is
> scanning every session to draw 365 cells, which is the query that makes an activity grid
> something you stop opening.
>
> **The rollup re-runs over a trailing window, not over yesterday alone.** A retroactive session
> entry lands on a day that was already rolled up. Rebuilding is delete-then-insert over the range,
> because an upsert can only revise a day upwards and the stale row for a day that is now empty
> would survive forever.

### 3.6 Row-level security

Every table above gets the same shape. No exceptions, including operational tables.

```sql
alter table missions enable row level security;

create policy missions_owner on missions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

**The API must connect as the requesting user, not as a superuser**, or RLS is decoration. Two connection paths:

- **`api`** — forwards the caller's JWT so `auth.uid()` resolves. Prisma has no hook for attaching
  session state to an operation, so this is an explicit transaction primitive rather than a
  transparently-scoped client:

  ```ts
  // packages/db/src/rls.ts
  export function runAsUser<R>(
    prisma: PrismaClient,
    claims: RlsClaims,
    fn: (tx: RlsTransaction) => Promise<R>,
  ): Promise<R> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(SET_CLAIMS, JSON.stringify(claims));
      await tx.$executeRawUnsafe(`set local role authenticated`);
      return fn(tx);
    });
  }
  ```

  **Two things must both be true, and getting either wrong fails silently and open** — the query
  succeeds and returns everyone's rows:

  1. **The connection must not own the tables.** Prisma connects as `postgres`, which owns them, so
     policies do not apply to it at all and setting `request.jwt.claims` alone changes nothing.
     `set local role authenticated` is what makes them bind. This is transaction-local, so it cannot
     leak across a pooled connection.
  2. **The query must run in the same transaction as the settings.** This section used to recommend a
     `$extends({ query: { $allOperations } })` wrapper whose callback opened a `$transaction` and then
     called `query(args)`. That does not work: `query` is bound to the base client and runs on a
     _different_ connection than `tx`. It looks right, type-checks, and isolates nothing — FR-A3 rested
     entirely on it for the whole of M0 and M1.

  Both failure modes are pinned by `packages/db/test/rls.test.ts` against the real database: `runAsUser`
  isolates, and claims without the role switch do not. Callers receive the transaction client and issue
  queries on it — which costs a little more to type than a magic client and buys two things worth
  having: it is correct, and a repository method that must write two tables atomically (a mission and
  its revision) already has its transaction.

- **`worker`** — has no request context. It uses the service-role key **and therefore bypasses RLS**. Every worker query must filter `user_id` explicitly. Enforce this with a lint rule and a code-review checklist item; it is the single most likely place a cross-user leak appears.

---

### 3.9 The activity grid — the frequency tracker

A year of days as a heatmap — the familiar shape, minus the one feature GitHub made famous.

**Opacity is focus minutes**, bucketed into quartiles of your own non-empty days across the window:
a thirty-minute day is a real day for someone whose days are thirty minutes, and an absolute scale
renders their entire year as the palest shade — which says nothing and reads as failure. An empty
cell is neutral — no shading of shame, because rest days are part of the design.

**Consistency, not streaks.** No counter that resets to zero and shames you. The figure alongside
the grid is **active days in the last 28** — it degrades gracefully, recovers naturally, and can't
be broken by one bad week (FR-Q1).

**It ships with at most one derived line**, and only when there's something true to say:

> _"You have never once logged a Saturday."_

**Implementation.** Reads `daily_activity` only — never raw sessions. 365 rows per user, so the
whole year is one indexed query and the grid is instant. Mobile shows a 12-week window that scrolls
horizontally in its own container; the full year is desktop.

**What reaches it.** Focus sessions, and nothing else — not lessons finished, not outcomes recorded,
not teach runs. Since FR-F5 that includes the sessions the reader starts by itself, which is what
stopped an afternoon of reading from rendering as a rest day. Two properties of the pipeline are
worth holding together when reading a quiet-looking grid:

- **A read under a minute contributes nothing.** `elapsedMinutes` floors, `daily_activity` sums it,
  and the grid treats `> 0` as active. The day gets a row and stays an empty cell.
- **Today is not on the grid until the rollup runs.** The nightly job runs once per user per local
  day after 03:00 and marks itself done, so an afternoon's work lands tomorrow morning. The panel
  prints `rebuiltAt` underneath for exactly this reason — a stale grid and an empty one are otherwise
  the same picture — but today's own cell still reads as a rest day when it is not one yet. Nothing
  in `apps/api` writes `daily_activity`, so there is no read-time repair; closing it means either
  overlaying today's raw sessions in the reader or marking today's cell "not rolled up yet" rather
  than empty. Neither is built.

---

## 4. Auth

- **Supabase Auth** issues the JWT. SPA holds the session via `@supabase/supabase-js` and refreshes it; the API never issues tokens.
- **`SupabaseAuthGuard`** (Nest) verifies the JWT signature against Supabase's JWKS, extracts `sub` → `userId`, attaches it to the request. Applied globally with an `@Public()` decorator escape hatch.
- **Providers:** email + password (with verification and reset, both handled by Supabase) and GitHub OAuth.
- **Data export** (FR-A4): a worker job that streams every table filtered by `user_id` to JSON, plus the raw workspace files as Markdown/HTML, zipped to a signed Storage URL that expires in 24h.
- **Account deletion:** `on delete cascade` from `auth.users` covers Postgres; a worker job deletes the Storage prefix. Both must run, and deletion is confirmed only after both succeed.

---

## 5. Frontend notes

- **Optimistic everything for capture.** The timer's mutations write to the TanStack Query cache immediately and reconcile on response. This is the implementation of the ≤5s / ≤2-tap budget (`REQUIREMENTS.md` §7.1) — a capture that waits on a round-trip has already failed it.
- **Offline queue.** Session start/stop are queued in IndexedDB when offline and flushed on reconnect. They carry client-generated UUIDs so replay is idempotent. Losing a session because you were on the subway kills trust in the data.
- **Command palette (⌘K)** as the primary navigation and capture surface **on desktop**. It is not the mobile answer; see §5.1.
- **Live session state** over SSE from the API, so a timer running on your laptop is visible on your phone. (Not built yet — the mission card polls while a run is live; see CLAUDE.md.)
- **PWA** with a service worker for install + offline shell. Not a native app (`REQUIREMENTS.md` non-goals).

---

## 5.1 Mobile

**Mobile-first for capture and review; desktop-first for analysis and authoring.** That split is the design, not a compromise — and it follows from where each activity actually happens.

| Surface                                | Primary target | Why                                                                        |
| -------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| Focus timer (start / stop / debrief)   | **Mobile**     | You start focusing away from the desk as often as at it.                   |
| Lesson outcome (understood/shaky/lost) | **Mobile**     | Two taps at the end of a lesson, wherever you read it.                     |
| Lessons                                | **Both**       | Must read well on a phone — see the agent constraint below.                |
| Curriculum browsing                    | Desktop        | Seeing a module's shape needs width.                                       |
| The activity grid                      | Desktop        | Comparison needs pixels. Mobile gets a reduced window, not a squeezed one. |
| Mission editing, memory review         | Desktop        | Long-form writing.                                                         |

### What this actually requires

- **Touch targets ≥44×44px** on every capture control.
- **Thumb-zone layout.** Primary actions live at the _bottom_ on mobile, not the top. When a focus session is running, a persistent bottom bar carries stop — reachable one-handed without navigating.
- **A mobile capture affordance that isn't the command palette.** A bottom sheet with the same actions, opened from a single persistent button. Same action registry, different surface.
- **`dvh`, not `vh`.** iOS Safari's dynamic toolbar makes `100vh` wrong; a timer screen that scrolls under the URL bar looks broken.
- **`env(safe-area-inset-*)`** on the bottom bar, or it sits under the home indicator.
- **Offline matters most here.** The IndexedDB queue exists primarily for mobile — the subway case is the realistic one.
- **PWA install** for standalone display and, on iOS, because notifications require it.
- **Charts get mobile variants**, not squeezed desktop ones. The year of days becomes a 12-week window; the full comparison stays desktop.
- **Test at 375px**, not just at a breakpoint boundary. Playwright runs the capture-loop E2E in a mobile viewport as well as desktop.

### The non-obvious one: agent-generated lessons must be responsive

The `teach` skill writes lesson HTML, and nothing stops it writing fixed-width layouts that break on a phone. Two enforcement points:

1. **The shared stylesheet in `assets/`** — which the skill already treats as the first component every workspace earns — ships with a responsive baseline: fluid type, `max-width` in `ch`, no horizontal overflow, tables and code blocks in their own `overflow-x: auto` container.
2. **`BRIEFING.md` states the constraint** so the agent authors against it: lessons are read on a 375px screen as often as a laptop.

Then verify it: the lesson-rendering E2E test loads a generated lesson in a mobile viewport and asserts the document never scrolls horizontally. That's a cheap, real check on output nobody wrote by hand.

---

## 5.2 Internationalization — en and pt-BR

**Set this up in M0.** Retrofitting i18n means touching every component that was ever written, and hardcoded strings accumulate faster than anything else in a codebase. It is cheap now and expensive in three months.

### Three independent axes

The common mistake is collapsing these into one setting. They are genuinely separate, and for this user in particular they will _not_ agree.

| Setting                              | Controls                                                | Default                                         |
| ------------------------------------ | ------------------------------------------------------- | ----------------------------------------------- |
| **UI locale** (`en`, `pt-BR`)        | Interface strings, date/number formatting               | Browser `Accept-Language`, then user preference |
| **Timezone** (IANA)                  | Every "day", "week", nightly job, and the activity grid | Browser-detected, user-editable                 |
| **Content language** (`en`, `pt-BR`) | The language the agent writes lessons and briefings in  | Follows UI locale, **separately overridable**   |

That third axis is the one worth having. A Brazilian engineer learning distributed systems will very reasonably want a **pt-BR interface and English lessons**, because the source material, the vocabulary, and the community are all English. Forcing lessons into the UI language would make the product worse. Store it as its own preference.

Search stemming follows a fourth thing: **the language of the content itself** (`notes.lang`), because a note written in Portuguese needs the Portuguese stemmer regardless of what the UI is showing.

### Implementation

- **`react-i18next` + ICU MessageFormat**, namespaced per feature (`missions`, `focus`, `insights`…). Translation files live at `apps/web/src/locales/{en,pt-BR}/<namespace>.json`.
- **`Intl` for everything formattable** — `DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`. Never hand-format a date or concatenate a sentence.
- **Enum values are keys, never display text.** The database stores `understood`, `deep_dive`, `parked`; the UI translates at render. This is already how the schema is written — keep it that way.
- **Server-side strings** (emails, export filenames, notification copy) get their own bundle in `packages/core`, resolved from the user's stored locale, not a request header.
- **`lang` and `dir` on `<html>`** set from the active locale.

### The domain glossary is the hard part

Module, mission status, memory kinds, and the outcome vocabulary are **product concepts, not UI
chrome**. Translating them ad-hoc per string guarantees drift — the same term rendered three ways
across three screens. Translate the glossary once, in one file, and derive every usage from it.

### Locale-sensitive behaviour that isn't a string

- **Week start.** pt-BR convention is Sunday, en-GB is Monday. The activity grid's columns depend
  on it — so it is a **user preference seeded from locale**, not derived from it at render time.
- **Duration formatting.** `6h 20m` vs `6h20`. One helper in `packages/core`, never inline.
- **Decimal separator** in every number. `Intl.NumberFormat`, always.

### Agent and model output

- **`BRIEFING.md` states the content language**, so the teach agent writes lessons in it.
- **Lesson HTML gets a `lang` attribute** matching the content language, which also fixes
  hyphenation and screen-reader pronunciation.

### Testing

- A **missing-key check in CI**: every key present in `en` must exist in `pt-BR`, and vice versa. A missing translation fails the build rather than silently rendering a key.
- **No hardcoded user-facing strings** — an ESLint rule (`i18next/no-literal-string`) on `apps/web/src/**`, scoped to JSX text and `aria-label`.
- E2E runs the capture loop once in each locale. pt-BR strings are longer than English on average, and layouts break where they were sized to English.

---

## 5.3 Key screens and first run

### Today

The screen you'll see most, and the only one where the ≤5s budget is genuinely tested. **One job: get you into a focus session in one tap, or tell you why you shouldn't.**

Vertical order is fixed, and each block hides entirely when it has nothing to say — an empty section is worse than no section:

```
┌────────────────────────────────────────────┐
│  RUNNING SESSION  (only while one is live) │  elapsed · intention · Stop
├────────────────────────────────────────────┤
│  NEXT                                      │  the next unblocked lesson (M4+),
│                                            │  or the active mission
│                                            │  [ Start focus ]  ← primary
└────────────────────────────────────────────┘
```

**Rules for this screen:**

- **No greeting, no date header, no motivational copy.** The first pixel is information.
- **At most one primary action.** Start focus. Everything else is a link.
- **"One thing" shows nothing rather than filler.** If there's no honest insight today, the block is absent. A daily insight that's manufactured to fill space trains you to stop reading it.
- On mobile the running-session block becomes the **persistent bottom bar** (§5.1) and the rest scrolls beneath it.

### First run

You sign up into an empty account: no missions, nothing to press. That's where most personal tools lose people.

**The answer is a guided first mission, not a tutorial.** You learn the app by using it on something you actually want to learn — and it produces real rows, not demo data you'll have to delete.

Two steps, skippable at any point, resumable from a banner:

| Step                                             | Produces                           | Why it's this one                                                                                                                              |
| ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. _What do you want to get better at, and why?_ | A **Mission**                      | The `teach` skill's whole philosophy grounds on the "why". Asking it first is not onboarding fluff — it's the thing every later feature reads. |
| 2. _Do 15 minutes on it now._                    | A **Focus Session** with intention | The habit is the product. Ending the tour inside the core loop is the point.                                                                   |

**No questionnaire about how you learn** — those answers are usually wrong, and the learner memory (§7.6) is designed to be populated from behaviour instead.

The empty state on every other screen names one action and links to it. Never an illustration and a shrug.

### Parked missions

Parking is not archiving. A parked mission keeps its curriculum and its history, is excluded from
the teach button, and still counts in the activity grid — history is history.

---

## 6. API surface

NestJS modules, one per bounded context. REST with Zod-validated DTOs from `packages/core`.

| Module       | Key routes                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missions`   | `GET/POST /missions`, `PATCH /missions/:id` (revision recorded on mission-field change), `POST /missions/:id/park`                                          |
| `focus`      | `POST /focus/sessions/start`, `POST /:id/stop`, `POST /:id/debrief`, `POST /focus/sessions` (manual/backfill)                                               |
| `teach`      | `POST /missions/:id/teach` → 202, `GET /agent-runs/:id`, `GET /missions/:id/agent-runs`, `GET/POST/DELETE /me/memory…`                                      |
| `insights`   | `GET /insights/activity`                                                                                                                                    |
| `curriculum` | `GET /missions/:id/curriculum` — modules, their planned lessons, and every state derived from the graph (FR-K5)                                             |
| `lessons`    | `GET /lessons/:id` (mints the view grant), `PUT`/`DELETE /lessons/:id/completion`, `GET /missions/:id/reference-docs`, `GET /missions/:id/learning-records` |
| `account`    | `GET/PATCH /me`, `POST /me/changelog-seen`, `POST /account/export` (planned), `DELETE /account` (planned)                                                   |

**`GET /lessons/:id` mints a credential, so it answers `Cache-Control: no-store`** — and so does the
reference list, whose URLs are signed by one grant and expire together. A cached response outliving
its grant is a reader showing a blank frame with nothing to say about why.

**Completion is a `PUT`, not a `POST`.** Marking the same lesson understood twice is the same lesson
understood once, which is what lets the SPA retry without asking whether the first attempt landed.
`DELETE` clears it — a correction for a mis-tap, not a way to reset progress (FR-P1).

**Long operations never block a request.** Anything touching the LLM returns `202` with an `agent_run_id`; the SPA subscribes to `GET /agent-runs/:id/stream` (SSE) for progress and the terminal result.

### 6.1 Conventions

- **Base path `/v1`.** Cheap now, impossible to retrofit politely.
- **Errors are RFC 7807 `application/problem+json`.** One shape, so the SPA's error mapping is written once:

  ```json
  {
    "type": "https://mindforge.app/errors/wip-limit-reached",
    "title": "Too many active missions",
    "status": 409,
    "detail": "You have 3 active missions. Park one before starting another.",
    "instance": "/v1/missions",
    "errors": [{ "field": "status", "code": "wip_limit", "message": "…" }]
  }
  ```

  `detail` is user-facing and **translated** (§5.2); `type` and `errors[].code` are stable machine keys and never translated. Validation failures use `422` with a populated `errors` array; everything else uses `errors: []`.

- **Idempotency.** Capture endpoints (`POST /focus/sessions/start`, `POST /focus/sessions`) accept a client-generated UUID as the resource id and are upserts. This is what makes the offline queue safe to replay — retries are free, and the client never has to reason about whether a request landed.
- **Pagination** is cursor-based (`?cursor=&limit=`) on every list. Offset pagination breaks the moment a nightly job inserts rows mid-scroll.
- **`ETag` + `If-None-Match`** on read-heavy dashboard endpoints. The insight rollups change once a night.

---

## 7. The `teach` integration

This is the hardest part of the system and the reason the architecture looks the way it does.

### 7.1 Why the Agent SDK

`teach` is a **Claude Code skill**: a `SKILL.md` with frontmatter, plus three format docs, that assumes a working directory it can read and write with file tools. Three ways to run that on a server:

| Option                                                                                                                                                                                                                                                                            | Verdict                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — Claude Code as a library: the full harness plus built-in Read/Write/Edit/Bash/Glob/Grep, subagents, permissions, sessions. You host the compute.                                                                        | **Chosen.** `SKILL.md` runs unchanged. You own the filesystem, so file↔DB sync is a local diff instead of a network protocol. Same code path as local `/teach`, so the two can't drift.                                                                                                                                                                                    |
| **Anthropic Managed Agents** — Anthropic hosts the loop _and_ a per-session container. `teach` uploaded as a custom Skill; one **memory store** per Mission as a persistent FUSE-mounted workspace with built-in versioning and an audit trail; outputs pulled via the Files API. | Genuinely attractive — the memory store maps beautifully onto a teaching workspace and would delete §7.4 entirely. Rejected for v1 because it's beta, individual memories cap at ~100KB (lesson HTML with inline assets can exceed that), and it would fork the skill format away from local `/teach`. **Revisit at v2** — if it stabilizes, it removes a whole subsystem. |
| **Raw Messages API + own tool loop**                                                                                                                                                                                                                                              | Cheapest and most controlled, but reimplements the teach philosophy (ZPD, storage vs. fluency strength, mission grounding) as prompt text you now maintain, and abandons file compatibility. Only worth it if the Agent SDK proves too slow or expensive.                                                                                                                  |

> ⚠️ **Verify before building.** The Agent SDK's exact API (`query()` signature, options, session handling, permission model) must be read from `code.claude.com/docs/en/agent-sdk` — the pseudo-code below shows the _shape_ of the integration, not verified call signatures. Treat §7.3 as a design sketch to be confirmed against the docs on day one of that milestone.

### 7.2 Workspace layout in Storage

One Supabase Storage prefix per Mission, mirroring the `teach` skill's directory contract exactly:

```
workspaces/<user_id>/<mission_slug>/
  MISSION.md
  CURRICULUM.md
  RESOURCES.md
  NOTES.md
  lessons/0001-<slug>.html
  reference/<slug>.html
  learning-records/0001-<slug>.md
  assets/style.css, quiz.js, …
```

Because the layout is byte-identical to a local teaching workspace, `mindforge pull <mission>` / `push` (a small CLI, v2) makes the round trip to local `/teach` trivial. Design for it now; build it later.

### 7.3 The agent worker

> **Verified against `@anthropic-ai/claude-agent-sdk@0.3.222`** (which bundles CLI `2.1.222`), reading
> `sdk.d.ts` rather than the docs, on M3 day one as §16.1 required. Line references below are into that
> file. The previous version of this section was a sketch and was wrong in nine places; the ones that
> would have shipped silently are marked **⚠**.

```ts
// apps/worker/src/modules/teach/infrastructure/agent-sdk.gateway.ts
const ac = new AbortController();
const deadline = setTimeout(() => ac.abort(), TEACH_TIMEOUT_MS);

try {
  for await (const message of query({
    prompt:
      "Teach me the next thing. Read BRIEFING.md first — it has my current " +
      "current module, the lessons already in it, and what is not measured yet.",
    options: {
      cwd: dir,
      model: "claude-opus-5",
      effort: "high", //  the SDK will not read packages/llm's EFFORT for you
      maxTurns: 40,
      maxBudgetUsd: TEACH_BUDGET_USD, //  second cap; unlike `usage`, it counts subagents
      abortController: ac, //  ⚠ there is no `abortSignal` option (:1327)
      tools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
      disallowedTools: ["Bash"], //  removes the definition from the request (:1390)
      permissionMode: "dontAsk", //  deny anything not pre-approved
      plugins: [{ type: "local", path: TEACH_PLUGIN_DIR }], //  how the skill loads — see below
      skills: ["mindforge-teach:teach"], //  namespaced; a bare "teach" matches nothing
      settingSources: [], //  ⚠ else the run inherits the host's ~/.claude
      strictMcpConfig: true,
      env: { ...process.env, CLAUDE_CONFIG_DIR: runConfigDir }, //  ⚠ replaces, never merges
    },
  })) {
    await this.onMessage(message); //  persist here, not after the loop
  }
} catch (err) {
  await this.onRunError(err); //  ⚠ a failed query yields its result *and then throws*
} finally {
  clearTimeout(deadline);
  await fs.rm(dir, { recursive: true, force: true });
}
```

**What the types actually say**, since three of these are the difference between a working run and a
silently wrong one:

- **`query()` takes one object and returns an async generator** — `query({ prompt, options })`, and
  `Query extends AsyncGenerator<SDKMessage, void>` (`:2587`, `:2279`). There is no `await`ed result
  object, so there is no `result.usage` to read at the end.
- **⚠ `allowedTools` restricts nothing.** Its own doc comment: _"List of tool names that are
  auto-allowed without prompting… To restrict which tools are available, use the `tools` option
  instead"_ (`:1368`). A tool merely absent from `allowedTools` is still in the model's context and
  still callable. The old sketch listed six tools there and commented "No Bash" — Bash was never
  withheld, only left un-auto-approved. Restriction needs `tools` (the base surface),
  `disallowedTools` (removes the definition outright), and `permissionMode: "dontAsk"` as the
  deny-by-default floor. Assert `Bash` is absent from `system/init`'s `tools` array (`:4446`) rather
  than trusting any of them.
- **⚠ `options.env` replaces the subprocess environment; it does not merge.** _"not merged with
  `process.env`. Spread `process.env` yourself if the subprocess still needs inherited variables like
  `PATH`, `HOME`, or `ANTHROPIC_API_KEY`"_ (`:1436`). Omitting the spread strips the API key and the
  run fails to authenticate. (The Python SDK merges. The TypeScript one does not.)
- **⚠ A failing run yields a result message and then throws.** `SDKResultError` (`:4295`) has
  `subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | …` and — unlike
  `SDKResultSuccess` — **no `result` field**. Branch on `subtype` before reading it. Because the
  generator throws, anything written after the `for await` never runs on a failure path: the
  `llm_calls` rows, the sync, the run status. Persist inside the loop or in `finally`.
- **Usage arrives per message, and at two granularities.** Each `SDKAssistantMessage` (`:2876`)
  carries `message.usage` and an optional `request_id`; the terminal result carries `usage`,
  `modelUsage` (`:1265`) and `total_cost_usd`. **`usage` excludes subagent tokens while `modelUsage`
  and `total_cost_usd` include them** — count with `modelUsage`. See §8.6 for the dedupe rule.

**How the skill loads — the mechanism, because the obvious one does not work.** The previous version
said skill files are "copied into the workspace so the agent loads them exactly as Claude Code would
locally". Both halves are wrong. Copying `SKILL.md` into `cwd` makes it a file, not a skill:
discovery walks `.claude/skills/` in `cwd` and its ancestors, and only when `settingSources` includes
`'user'` or `'project'` — which multi-tenant isolation forbids, since those same sources drag in the
host's `~/.claude/settings.json` and `CLAUDE.md`. And the skill as written declares
`disable-model-invocation: true`, which means the model may never invoke it; only a human typing a
slash command can, and the SDK has no slash-command surface.

So: **the skill is loaded as a local plugin** (`plugins: [{ type: "local", path }]`, `:1757`), which
is the one mechanism that binds a skill directory to an arbitrary `cwd`. `TEACH_PLUGIN_DIR` is
**generated at build time** from `skills/teach/` with the `disable-model-invocation` line stripped and
the §7.3a addendum appended — not copied verbatim. The skill is then namespaced `mindforge-teach:teach`
and must be named that way in `skills` (`:3456`). The three format docs are _additionally_ copied into
the workspace root so the skill's relative links resolve, and all four files join `BRIEFING.md` on the
sync-back exclude list — otherwise they upload into the user's Storage prefix and diff as `deleted`
next run.

**A nonexistent plugin path is skipped silently** — no throw, the run just proceeds with no skill and
writes a plausible lesson from parametric memory, which is the one thing `SKILL.md` forbids. So assert
on the `system/init` message (`:4438`): `plugins` contains the expected name, `skills` contains
`mindforge-teach:teach`, `tools` excludes `Bash`. Fail the run loudly if not. The SDK does not expand
`~`; use `path.join(os.homedir(), …)`.

**All three assertions were confirmed to pass** by `apps/worker/scripts/teach-probe.ts`, which is the
M3 spike and the reason this section is fact rather than plan. Three things it established beyond the
assertions themselves:

- **`settingSources: []` does exclude the host's user skills.** The probe machine has seven skills in
  `~/.claude/skills/`; none appeared. What _does_ appear is the CLI's own bundled set, which is not
  filesystem-sourced and cannot be excluded this way — `options.skills` is what keeps them out of the
  system prompt.
- **`init.skills` lists what was _discovered_, not what was loaded into the prompt.** Asserting on it
  proves the plugin resolved, which is the failure that is otherwise silent — but it is not proof the
  skill is in context.
- **The init handshake happens before authentication**, so Q1–Q3 can be checked for free. An
  unauthenticated run still emits `init` and then fails with a synthetic result whose usage is all
  zeros — which is worth knowing before treating a zero-cost run as a cheap one.

**`CLAUDE_CONFIG_DIR` isolation also isolates the credentials.** That is correct in production, where
the worker authenticates with `ANTHROPIC_API_KEY` and needs no config directory at all (§11 — the key
exists only in `api` and `worker`). It is worth writing down because locally it presents as
`apiKeySource: "none"` and "Not logged in", which looks like a broken integration rather than working
isolation.

_Fallback if plugin loading fights back:_ inline the skill body via
`systemPrompt: { type: "preset", preset: "claude_code", append: skillBody }`. That loses progressive
disclosure (~9.5KB always in context) and keeps everything else, including the single shared `SKILL.md`
that §7.1 chose the Agent SDK for. Note that `SKILL.md`'s own `allowed-tools` frontmatter is ignored
under the SDK either way — tool scoping is expressed at the `query()` level or not at all.

**Design points:**

- **`BRIEFING.md` is what the agent knows before it teaches (FR-T3).** Generated fresh each run
  from the mission, the curriculum position, and recent learning records. It's a workspace file, so
  the agent reads it with the same tools it reads everything else — no special protocol.
  Regenerated (not appended) every run and excluded from sync-back. **Sections whose source table
  does not exist yet say so in words** — see §7.3b; a briefing that renders "0 lessons completed"
  is a measurement claim the model will teach from.
- **No `Bash` tool** — see the ⚠ above for why that takes three options rather than one.
- **Turn cap and hard timeout, both surfaced in `agent_runs`.** The turn cap is `maxTurns`. **The
  timeout is ours**: the SDK has no session timeout of any kind, so it is an `AbortController` plus a
  `setTimeout` cleared in `finally`, with `API_TIMEOUT_MS` and `CLAUDE_STREAM_IDLE_TIMEOUT_MS` passed
  through `options.env` as the inner limits. `maxBudgetUsd` is the third cap and the only one denominated
  in the thing that actually hurts.
- **One run per mission at a time**, enforced by a **partial unique index** —
  `create unique index agent_runs_one_active_per_mission on agent_runs (mission_id) where status in ('queued','running')`
  — insert, and let `23505` become a 409. Same shape as `weekly_allocations`' two partial indexes.
  (This used to say "a BullMQ job key". There is no Redis and no queue; see §10.) What the index does
  not give you and a queue would have: a lease. So `agent_runs.heartbeat_at` is written on every
  message and a reaper fails runs whose heartbeat has gone stale — without it, a worker that dies
  mid-run wedges that mission forever.
- **Ephemeral disk.** Railway containers have ephemeral filesystems, which is exactly right here:
  materialize → run → sync → delete. Never rely on disk surviving a deploy.
- **Each run is a subprocess.** `query()` spawns a `claude` CLI process over stdio — one session, one
  process, roughly 1 GiB RAM and 1 CPU while it runs. That is the number that sizes the Railway plan,
  and it is why concurrency is capped per mission rather than merely serialized per user.
- **The CLI binary ships as `optionalDependencies`** (eight platform packages pinned to the SDK
  version). `npm ci --omit=optional` — a common container-hardening default — installs no binary, and
  the failure surfaces at the first `query()` rather than at install time. Keep optionals, or install
  Claude Code natively and set `pathToClaudeCodeExecutable`.

### 7.3a The `SKILL.md` addendum — what an unattended run must override

§7.1 chose the Agent SDK so the skill "runs unchanged". It cannot run entirely unchanged: `teach` was
written for a human sitting there. The generated plugin appends an addendum covering each assumption,
ordered by how likely it is to end a run having produced nothing:

1. **It asks questions and waits.** _"If the user is unclear about the mission… your first job should
   be to question the user"_, and _"Confirm with the user before changing the mission."_ Nothing
   answers. The run burns turns or returns `subtype: "success"` having written no lesson. The addendum
   says: this run is unattended, never block on a question, work from `BRIEFING.md` when `MISSION.md` is
   thin, and write open questions to a file the app surfaces rather than asking. Never edit `MISSION.md`
   — propose the change in a note. This is a larger stall risk than the missing Bash tool, and it is
   backstopped in code: **a `success` result with no added or modified file under `lessons/` is
   recorded as a failure**, not a success.
2. **It opens lessons with a CLI command.** No Bash, no display. End by reporting the relative path.
3. **It reads `./assets/` as a directory.** `Read` errors on directories — use `Glob`. Same for
   computing the next `NNNN`.
4. **Its in-lesson "ask your teacher followup questions" reminder points nowhere.** Lessons render on a
   separate origin under `connect-src 'none'` (§7.5) and can reach nothing. Word it to point at the app.
5. **`RESOURCES-FORMAT.md` asks for resources "actually inspected" with honest trust.** `WebFetch`
   cannot watch a video, listen to a podcast, or open a paywalled book. Uncorrected, the library fills
   with `trust: high` backed by landing pages — and trust is the exact field the teaching is grounded
   in. The addendum caps a landing page at `medium`.
6. **Its workspace inventory omits `BRIEFING.md` and `.memory/`.** An agent tidying to its own
   inventory can delete them. Both are declared read-only inputs.
7. **An absent section means unmeasured, not zero.** Stated explicitly, because §7.3b's honest
   absences only work if the reader does not fill them in.

### 7.3b What the briefing cannot measure, and must therefore not claim

`BRIEFING.md` is read by a model that will treat a number as evidence. Non-negotiable 1 — _"unknown is
never rendered as zero"_ — is load-bearing here in a way it is not on a screen a human can squint at: a
fabricated "0 lessons completed" produces teaching that repeats ground on false evidence.

| Section             | Needs                            | Arrives      | Renders as                                             |
| ------------------- | -------------------------------- | ------------ | ------------------------------------------------------ |
| ~~Lesson outcomes~~ | `lessons.completed_at`/`outcome` | **M5, done** | the finished lessons and how each landed, newest first |
| What next           | records' `## Next` only, today   | partial      | labelled as records-only, not as "your ZPD"            |

**Enforced by types, not by discipline.** `renderBriefing()` takes a `BriefingInput` whose unavailable
fields are `{ status: "not-tracked"; reason: string }` rather than `number | null`. A number is not
constructible for a section with no source table, so a later edit cannot accidentally render zero.

**Lesson outcomes were the worked example, and M5 spent it.** The section said the day the signal
became real would be a deletion here, and it was: `BRIEFING_ABSENCES` is gone, `lessonOutcomes` is a
plain list, and `PrismaBriefingReader` queries the column it previously refused to. Two things about
what replaced it:

- **An empty list is now a measurement, and says so.** `NO_OUTCOMES_YET` reads "an empty result
  rather than a missing signal", because "nothing is finished" and "nothing was ever recorded" call
  for different teaching and the agent has no way to tell them apart from a blank section.
- **A completion with no outcome renders as one.** M4 wrote rows finished before the reader could ask
  how it went; dropping them would understate what the learner has done, and guessing would be
  worse, so the line says "finished, outcome not recorded".

The `NotTracked` machinery stays — `NO_TRACK` still uses it, and the next section that outruns its
source will need it.

### 7.4 Sync protocol (files ↔ Postgres)

Files are canonical. Postgres is a rebuildable index. `workspace_files` is the ledger that makes the diff cheap and conflicts detectable.

> **Probed against the running stack** (`storage-api v1.60.4`, `@supabase/storage-js 2.112.1`) rather
> than assumed, because the conflict design rests entirely on what Storage will and will not promise.
> What it gives you: an ETag, which is `md5(content)` for a single-part upload, readable from
> `list()` (`FileMetadata.eTag`) and from `info()` — and `info()` also returns a `version` UUID.
> Conditional **reads** work (`If-None-Match` → `304`). What it does **not** give you: an ETag on the
> upload response, and any conditional **write** at all — a `PUT` carrying a deliberately wrong
> `If-Match` returned `200` and overwrote the object. **There is no compare-and-swap.**

**Materialize (Storage → disk):**

1. `list()` the prefix **first**, recording `path`, `metadata.eTag` and `size` as the **baseline**.
   The order matters: `download()` hands back a `Blob` and discards response headers, so the ETag can
   never come from the download step.
2. Download every object into `/tmp/ws/<runId>/`, recording `content_hash` (sha256) per file.

**Sync back (disk → Storage):**

1. Walk the directory, hash every file. Apply the exclude list **at the walk**, not at the upload —
   `BRIEFING.md`, `SKILL.md` and the three format docs are inputs we wrote, and a file excluded only
   from upload still diffs as `deleted` on the next run.
2. Compare to baseline: `added` / `modified` / `deleted` / `unchanged`.
3. Re-`list()` the prefix and compare each changed file's current `eTag` to the baseline. A mismatch
   means someone else wrote in between → **conflict**. This is a list, not a download, which is the
   whole reason to use the ETag rather than re-hashing.
4. Upload changed files; delete removed ones; **re-`list()` again** to learn the new ETags, since the
   upload response does not carry them; update `workspace_files`.

**What this check is, and what it is not.** It detects a concurrent write cheaply. It is **not**
atomic: with no `If-Match`, there is a real window between the check and the write that nothing at the
Storage layer closes. And since the ETag is `md5(content)`, it encodes the same fact
`workspace_files.content_hash` already does — its only advantage is that listing is cheaper than
downloading. `version` is the strictly better change token and is recorded alongside it in
`workspace_files.storage_version`: a byte-identical rewrite leaves the ETag unchanged and moves the
version, which is the difference between "nothing happened" and "somebody wrote".

**So the ETag is not what prevents the race** — the `agent_runs` single-active-run partial unique index
(§7.3) is. The ETag catches the _other_ writer: a local `/teach` push, or an edit made in the UI. The
residual window is survivable because of retention, not locking, which is exactly what non-negotiable 6
asks for.

**Conflicts are surfaced, never resolved silently.** On mismatch the run is marked
`succeeded_with_conflicts`, both versions are retained (the incoming write lands at
`<path>.conflict-<timestamp>`), and the UI shows a resolution screen. Losing a lesson to a silent
overwrite would be unforgivable in an app about learning.

One consequence to handle rather than discover: a `.conflict-` file landing in `lessons/` is picked up
by the reindexer's filename parse and collides on `unique (mission_id, seq)`. Conflict copies are
excluded from indexing by name.

**Reindex** parses the changed files into Postgres:

| File                         | Parsed into                                                                              | Parser                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `MISSION.md`                 | `missions` (revisions via `applyEdit`, never `## History`)                               | Headed-section Markdown per `MISSION-FORMAT.md` |
| `CURRICULUM.md`              | `tracks`, `track_edges`, planned `lessons`, `lesson_edges`                               | Markdown tables per `CURRICULUM-FORMAT.md`      |
| `RESOURCES.md`               | **nothing** — a workspace file for the agent's grounding (FR-K4), synced but not indexed | —                                               |
| `learning-records/NNNN-*.md` | `learning_records`                                                                       | Sections per `LEARNING-RECORD-FORMAT.md`        |
| `lessons/NNNN-*.html`        | `lessons` (title from `<title>`/`<h1>`, track from `<meta>`)                             | Cheerio                                         |
| `reference/*.html`           | `reference_docs`                                                                         | Cheerio                                         |

`CURRICULUM.md` upserts on `(mission_id, slug)` and **never deletes**: the agent rewrites the file
wholesale, `tracks.status` is not expressible in it, and a track dropped from one regeneration would
take a module of finished lessons with it. A track that vanishes from the file is marked `dropped`,
not removed — and `lessons` upserts where `workspace_files` delete-then-inserts, because
`completed_at` and `outcome` are state the file does not carry.

A lesson's `track_id` comes from its own `<meta name="mindforge:track">`, never from
`CURRICULUM.md`, and resolves against every track that already exists rather than only those parsed
in the same run — the run that writes a lesson normally leaves the curriculum untouched. A tag
naming a track that does not exist leaves the lesson unfiled with a warning.

The `## Module:` tables are the one place `CURRICULUM.md` does write `lessons`, and only ever the
planned half of one: a row with no file, upserted on `(mission_id, slug)` (§3.2b). It never touches a
row that already has a file — the plan may revise a lesson's title, intent, difficulty and
dependencies, and it may not revise what a lesson turned out to be, which is what the file says. A
planned lesson that vanishes from a regeneration is deleted rather than marked, because a row with
nothing behind it is the one thing here that costs nothing to rebuild; a _written_ lesson dropped
from the plan keeps its row and its module, and the plan simply stops mentioning it.

**Parse defensively.** The `teach` skill's formats are a contract you don't control; a format change must degrade to "file stored, partially indexed", never "run failed" and never "content lost". Every parser returns `{ parsed, warnings[] }` and warnings surface in the run result.

### 7.5 Serving lesson HTML safely

Lessons are **LLM-authored HTML with inline JavaScript** (quizzes, simulators). Treating them as trusted would be a serious mistake.

- Served from a **separate origin** (`lessons.<domain>`) by the tiny `lessons` service. Different origin means a lesson can't touch the app's cookies, `localStorage`, or Supabase session even if everything else fails.
- Rendered in `<iframe sandbox="allow-scripts allow-popups">`. **Never add `allow-same-origin`** — combined with `allow-scripts` it lets the frame remove its own sandbox attribute and defeats the whole mechanism.
- Response CSP on the lessons origin: `default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors https://<app-domain>`. `connect-src 'none'` means a lesson cannot exfiltrate anything.
- The lessons service authenticates via short-lived grants minted by the API after an RLS-checked ownership test. It never trusts a path from the client — the path is resolved from the lesson row.
- Relative links (`../reference/x.html`, `./assets/style.css`) work because the service serves the whole workspace tree — which is exactly why per-request ownership checks on the path prefix are non-negotiable.

**The grant, as built in M5** (`packages/core/src/lessons/view-token.ts`):

- **It is a path segment, not a query parameter.** `/v/<grant>/<path inside the workspace>`. That is
  forced by the relative links above: a relative URL carries the path and drops everything else, so a
  grant in a query string is lost by the first `../`. A cookie would need the two origins to be
  same-site, which is the isolation this whole design exists to create.
- **It covers a workspace prefix, not a file.** A per-file grant would serve the document and 404
  every image in it. So the ownership test is per mission, and the second half of the check is
  `resolveGrantedPath`, which decides whether the requested path stays underneath — every segment
  vetted against what a segment may contain rather than normalised and hoped over.
- **HMAC-SHA256, not a JWT.** No algorithm field to confuse, no library, no `alg: none`. It lives in
  `packages/core` because the API signs and the lessons service verifies: a second implementation of
  the verifying half is how a signature check becomes a string comparison that happens to return
  true. `apps/lessons` runs on Bun and reads core from source through a `bun` export condition, so
  no build step stands between the two halves of one security primitive.
- **Thirty minutes, and never refreshed in place.** Long enough to read a lesson without its images
  dying, short enough that a pasted URL has stopped working by lunchtime. Swapping the `iframe`'s
  `src` mid-lesson would reload the document and throw away whatever state the lesson's JavaScript
  was holding, which for a simulator is the entire lesson.
- **`Referrer-Policy: no-referrer` is load-bearing, not hygiene.** The grant is in the URL, so a
  lesson linking out to real documentation would otherwise hand that site a working token.
- **Content types come from the filename** (`contentTypeFor`, also in `packages/core`, also used by
  the worker at upload). Storage records a mimetype only when the uploader said so — anything
  restored by hand comes back `application/octet-stream`, and with `nosniff` set that is a lesson the
  browser offers to download instead of rendering. Measured against local Storage, not assumed.
- **Every failure is a 404**: expired, forged, malformed, traversing, missing. Distinguishing them
  tells a prober which half of the token to keep working on.

**The chrome around the frame is the reader's, not the app's.** Two settings, both measured rather
than guessed:

- **The frame is `100dvh`.** It was `calc(100dvh - 18rem)`, subtracting the chrome above and the
  outcome tray below so all three would fit one screen. That goal was not reachable and was not
  happening — the tray, the next-lesson panel and the learning records all sit below the lesson, so
  the page scrolled by 233px on a 1280×800 window and produced the two scrollbars the subtraction
  existed to avoid. What it bought with a third of the window was a lesson given 64% of it, in a
  screen whose only job is showing one. The page scrolls, deliberately, and the frame is sized for
  the position you read it in rather than the one you arrive in. The cost is that the outcome tray is
  a scroll below rather than beside the lesson; it stays a ≤2-tap path and stays `sticky` on a phone.
- **The top bar loses its nav on this route** (`AppShell`'s `compact`, set by `Shell`). Four nav
  items wrap to a second row below 640px, which was 113px of app furniture over 512px of lesson;
  compact is 53px at every width. Safe only because ⌘K reads the same route table the bar does, there
  is a visible button beside it for phones with no ⌘ to press, and the reader renders its own link
  back — nothing removed here was the only route to anywhere, and `lesson.spec.ts` asserts all three.

**No `postMessage` channel, and deliberately not.** Earlier drafts of this section had lesson → app
communication for completion and quiz results. Nothing emits it: the outcome is captured by the app's
own chrome under the frame, which is a tighter capture path than anything the lesson could offer, and
a listener with no sender is the "column nothing writes" mistake this project has already made twice.
It arrives with the first lesson that has something to say — with a strict `origin` check on the
parent side and a schema check on the payload, never `eval` and never trusted structure.

### 7.6 Per-user memory (cross-mission)

`teach`'s `NOTES.md` is **per workspace** — it can't tell a Rust mission what a Portuguese mission learned about how you like to be taught. Mindforge adds a **learner memory** that spans every mission.

**Layout** — a second Storage prefix, materialized into every agent run alongside the mission workspace:

```
memory/<user_id>/
  background.md            who you are, what you already know, how you work
  teaching-preferences.md  what lands: worked examples first, no analogies, terse
  learning-patterns.md     observed: retains via building, not reading
  constraints.md           30 min/day weekday, no video, screen-reader user
```

Mounted read-write at `<workspace>/.memory/` for the run. The agent reads and writes it with normal file tools — no special protocol, same as everything else it touches.

**Rules:**

- **The agent writes it; you own it.** Every write produces a `learner_memories` row the user can review, edit, or delete in a Memory settings screen. A model that silently accumulates conclusions about you is a trust problem, and wrong entries poison every future lesson.
- **Split it from mission state.** Facts about _you_ live here; facts about _a topic_ stay in that mission's `NOTES.md` and learning records. If a memory only makes sense inside one mission, it's in the wrong file.
- **One fact per file, with a one-line summary at the top** — that summary is what gets loaded for relevance selection when the memory grows past what's worth injecting whole.
- **Supersede, don't mutate.** Corrections write a new entry pointing at the old one via `superseded_by`. You want to see that your stated preference changed, not have it quietly overwritten.
- **Never store secrets or credentials here.** It's replayed verbatim into every future agent run, across every mission.
- **Same sync + conflict rules as §7.4**, keyed on `learner_memories.content_hash`.
- **Export and delete cover it.** It's part of the user's data (FR-A4) and goes in the export zip.

**Also feeds any future non-agent calls** — the memory summaries are the block that would be prepended to the cached system prefix (§8.4).

**Bootstrapping:** empty at signup. The agent populates it from the first few sessions; the user can also write entries directly. Don't build an onboarding questionnaire — the answers people give up front about how they learn are usually wrong.

---

## 8. LLM layer

All non-agent model calls go through `packages/llm` — no module calls the Anthropic SDK directly. That's what makes cost tracking, caching, and model swaps a one-file change.

### 8.1 Model selection

| Job                           | Model           | Why                                                             |
| ----------------------------- | --------------- | --------------------------------------------------------------- |
| Lesson generation (agent)     | `claude-opus-5` | The hardest, highest-value output. $5/$25 per MTok, 1M context. |
| Curriculum generation (agent) | `claude-opus-5` | The structure everything else hangs off.                        |

Defaults live in one config object, overridable per environment, so a model change is a deploy not a refactor.

### 8.2 Request conventions

- **Thinking is on by default on `claude-opus-5`** (omitting the field runs adaptive). Don't disable it — use `output_config: { effort }` to control depth. Note `max_tokens` caps thinking _plus_ response text, so size it with headroom.
- **`temperature`, `top_p`, `top_k` are rejected** on Opus 5 — steer with prompting.
- **Assistant prefills are rejected.** Use structured outputs.
- **Stream anything over ~16K `max_tokens`** and use `.finalMessage()`, or you'll hit SDK HTTP timeouts.
- **Set `effort` deliberately per call site.** `high` is the default; `low`/`medium` are unusually capable on Opus 5 and are the primary cost lever. Sweep them against real outputs rather than guessing.

### 8.3 Structured outputs

Every non-prose model call returns a validated object. One Zod schema per call site in
`packages/llm/schemas`, reused by the API DTO so the model's output and the API contract can't
drift. (The agent path does not use structured outputs — its contract is files, parsed defensively
per §7.4.)

### 8.4 Prompt caching

Caching is a **prefix match**: `tools` → `system` → `messages`, and any byte change invalidates everything after it. Minimum cacheable prefix on Opus 5 is 512 tokens. Reads cost ~0.1×; writes cost 1.25× (5-minute TTL).

Rules for `packages/llm`:

1. **The system prompt is frozen per purpose.** No timestamps, no user IDs, no session IDs, no conditional sections. Anything dynamic goes into `messages`, after the last cache breakpoint.
2. **Tool lists are sorted deterministically** and never vary within a purpose.
3. **Mission context is the cache boundary.** For repeated calls within one mission, put the mission + learning-records block first with a `cache_control` breakpoint at its end, and the varying part after it.
4. **Assert on cache hits in dev.** If `usage.cache_read_input_tokens` is 0 across repeated calls with the same prefix, something is silently invalidating it — log a warning in non-production.

For repeated calls over one mission's context, this is the difference between paying for it every time and paying for it once.

### 8.5 Cost control

- Every call writes a `llm_calls` row with token counts (including cache reads/writes) and computed cost.

  **The agent path is the exception to "everything routes through `packages/llm`", and it needs its own
  rule.** The Agent SDK never touches this package — it spawns a CLI subprocess that calls the API
  itself — so the rows are reconstructed from the run rather than written at the call site.

  **The message stream is not the whole bill.** Measured, not assumed: a one-turn probe
  (`apps/worker/scripts/teach-probe.ts`) reported two models in `modelUsage` and only one in the
  assistant-message stream. The invisible one was `claude-haiku-4-5` doing the SDK's own internal work,
  and it was **22% of that run's cost**. Result-level `usage` is no better — it covers the main model
  only, and excludes subagents. So:

  1. **One row per distinct `SDKAssistantMessage`**, keyed on `request_id` where present and
     `message.id` otherwise, purpose `teach_turn`. Both were populated in the probe, but `request_id` is
     optional on the type, so the column cannot be `NOT NULL`. The dedupe is not optional either:
     parallel tool calls emit several assistant messages sharing one id and carrying identical
     cumulative usage, so a row per message inflates tokens by the parallelism factor.
  2. **One reconciliation row per model** for whatever `modelUsage` reports that the turns did not
     account for, purpose `teach_overhead`. This is what makes the invariant hold: **the sum of a run's
     `llm_calls` equals its `modelUsage`.** Without it the cost meter quietly understates, and it
     understates by more as the agent leans on subagents.

  Two further traps, both of which kill a run rather than mis-report it:

  - **`modelUsage` is keyed by a dated model id.** The probe's key was
    `claude-haiku-4-5-20251001` with `canonicalModel: "claude-haiku-4-5"` in a separate field.
    `packages/llm`'s `PRICING` has the canonical id, so pricing the key directly **throws** — inside the
    message loop, which kills the run. Canonicalise first, and use a non-throwing variant that records
    `cost_usd = null` plus a warning when a model is genuinely unknown. A missing price is unknown, and
    unknown is not zero — which is also why the column is nullable.
  - **The SDK's own `total_cost_usd` is a client-side estimate** from a price table baked in when the
    SDK was built; its docs say not to bill from it. Store it on `agent_runs.result` as a cross-check
    against our own figure, never as the source of truth.

- Per-user monthly soft cap, configurable. On breach: user-initiated jobs warn and continue.
- A cost meter in the UI. If you're spending $80/month on lesson generation you should find out from the app, not the invoice.
- Rough order of magnitude for one lesson generation with warm cache: tens of cents. Measure it in the first week rather than trusting that estimate — agent runs vary enormously with turn count.

---

## 9. Algorithms (`packages/core`)

Pure, deterministic, exhaustively unit-tested. These encode the product's opinions, so they're the highest-value tests in the repo.

### 9.1 Module progress

Computed on read in `packages/core`, never stored (FR-P2..P5):

```
moduleProgress = completed planned lessons / planned lessons   -- dropped entries leave both sides
unblocked(l)   = every prerequisite of l is completed
fundamental(l) = l has dependents; rank by dependent count
nextLesson     = first unblocked, incomplete planned lesson,
                 module order then difficulty ascending
```

`moduleOutcomes` sits beside it (FR-P4) and returns four counts — understood, shaky, lost, and
**unrecorded**. The fourth is the one that keeps the other three honest: they have to sum to the
module's `completed`, or the screen shows three outcomes out of five finished lessons and leaves
the rest to guesswork. A completion with no outcome is a real row — M4 wrote some, and the reader
cannot retroactively ask how they went.

`missionProgress` aggregates them for the mission as a whole (FR-P3), and the two things it refuses
are the whole of its design. It sums **lessons rather than modules**, because a curriculum's tracks
run from three lessons to eight and counting modules would make finishing a short one worth more than
finishing a long one. And it sums **only the modules that have a plan**, returning how many it left
out — a module with no lessons contributes to neither side, because adding it as a zero would make
the fraction fall every time the curriculum grows a subtopic, which is a number moving on news that
is not about the learner at all. Null when nothing is planned, like its per-module counterpart.

"Unknown is never rendered as zero": a module with no plan yet returns null with a reason, and the
UI says which — it does not show 0%. A module that _has_ lessons and has finished none returns
zeros, because those are measured.

**The bar is a second channel, never a percentage.** `ProgressBar` draws the same fraction the line
above it states, carries it to a screen reader through `aria-valuetext`, and renders no `%` anywhere:
a percentage of a plan that gets revised reads as a measurement of the learner, where a fraction
reads as a count against a plan that is allowed to move. Null progress gets **no bar at all** rather
than an empty one — an empty track is a claim that something was measured and came out at zero, which
is the failure FR-P5 names. An empty track over a module that _has_ lessons is correct and different.

### 9.2 The lesson dependency graph

Cycle detection and edge resolution live in `packages/workspace/src/parse/curriculum.ts` today
(for `track_edges`) and extended to `lesson_edges` in M4 — the parser breaks cycles with a warning
rather than failing the file (a curriculum with one bad edge is still 14 good subtopics), and the
first path found wins, so the file's own reading order is the tie-break. The unblocked/fundamental
derivations live in `packages/core/src/curriculum/lesson-graph.ts`, next to the module-progress
maths that read the same edges.

### 9.3 The frequency figures

`buildGrid` buckets `daily_activity` rows into quartile intensities of the user's own non-empty
days, counts active days over the trailing 28, and emits at most one signal
(`never_on_weekday`) — see §3.9.

---

## 10. Background jobs

| Queue / job                         | Trigger                        | Notes                                                    |
| ----------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `teach:generate-lesson`             | User action                    | Agent SDK. One per mission concurrently. 15-min timeout. |
| `teach:sync-workspace`              | Manual, or after any agent run | Diff + reindex.                                          |
| `insights:rollup`                   | Nightly per user timezone      | Rebuilds `daily_activity` over a trailing window.        |
| `account:export` / `account:delete` | User action                    | Planned.                                                 |

Nightly jobs run **per user timezone**Nightly jobs run **per user timezone**, not at a global UTC hour. A "daily review queue" that rolls over at 4pm local is a bug.

**The `queue:job` names above are descriptive, not real.** There is no Redis and no queue — the
scheduler is a self-rescheduling `setTimeout` in `apps/worker`, and idempotency lives in Postgres
(`daily_activity`'s range rebuild and `agent_runs`' single-active-run partial index). `bullmq` and `@nestjs/bullmq` are declared by both
apps and imported by nothing. Read this table as "the jobs that exist", not "the queues they run on";
the names stay so the swap to a real queue is a rename rather than a redesign. `agent_runs.job_id` is
part of the same anticipation — an external job id, unused while the scheduler is in-process.

---

## 11. Security & privacy

This data is a detailed map of your weaknesses. Treat it accordingly.

- **RLS on every table**; worker code filters `user_id` explicitly and is reviewed for it (§3.6).
- **Lesson HTML is untrusted** — separate origin, sandboxed iframe without `allow-same-origin`, restrictive CSP, `connect-src 'none'` (§7.5).
- **SSRF guard** anywhere a user-supplied URL is fetched: block private/link-local/metadata IP ranges, cap redirects, cap response size, short timeout.
- **Secrets** live in Railway/Supabase env config. The Anthropic key exists only in `worker` and `api`, never in the SPA bundle.
- **What goes to Anthropic, and when** is documented in-app and logged. A user should be able to answer "did my mission notes get sent to a model?" from the UI. (Answer: only if they trigger a run that reads them.)
- **Rate limits** per user on LLM-triggering endpoints, independent of the cost cap.
- **PII in prompts:** the workspace and memory can be deeply personal. Send only what a run needs.

---

## 12. Observability

- **Structured logs** (Pino) with `requestId`, `userId`, `agentRunId` on every line.
- **Sentry** for both `api` and `worker`; agent-run failures are first-class errors, not swallowed job retries.
- **`llm_calls`** is the cost source of truth. A weekly internal query answers: cost per lesson, cache hit rate.
- **Agent run traces** stored as JSON (turn count, tools used, files touched, tokens) — when a lesson comes out bad you need to see what the agent actually did.
- **Health checks** on both services; Railway restarts on failure. The worker drains in-flight jobs on SIGTERM before exiting.

---

## 13. Testing

**Everything ships with automated tests at all three levels — unit, integration, and end to end. The global coverage floor is 80%, enforced in CI; a build below it fails and does not merge or deploy.**

### 13.1 Coverage policy

80% global, with **per-area thresholds** so the number means something. A flat 80% lets you hit the target by testing DTOs while leaving the scoring math bare — which is exactly backwards, because that's where a silent bug produces confidently wrong numbers rather than a crash.

| Area                                   | Lines    | Branches | Why                                                                                                                 |
| -------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                        | **100%** | **95%**  | The calendar, the grid, the graph helpers. A wrong number here is invisible and corrupts every downstream decision. |
| `apps/api` — `domain/`                 | 95%      | 90%      | Entity invariants are the rules of the product.                                                                     |
| `apps/api` — `application/`            | 90%      | 85%      | Use cases: every command and query has at least a success and a failure test.                                       |
| `apps/api` — `infrastructure/`         | 80%      | 70%      | Repository impls and mappers, covered via integration tests against real Postgres.                                  |
| `packages/llm`                         | 85%      | 75%      | Pricing, cache-breakpoint construction.                                                                             |
| `apps/web` — `features/*/api`, `model` | 85%      | 75%      | Query keys, optimistic rollback, derived selectors.                                                                 |
| `apps/web` — `shared/ui`               | 80%      | 70%      | The component library every feature composes.                                                                       |
| **Global floor**                       | **80%**  | **75%**  | Fails the build below this.                                                                                         |

**Excluded from the denominator** (config, not laziness — these are generated or trivially declarative): generated Prisma client, migrations, `*.module.ts` wiring, `main.ts` bootstraps, type-only files, Storybook stories, test utilities.

```ts
// vitest.config.ts — root
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'json-summary'],
  thresholds: {
    lines: 80, branches: 75, functions: 80, statements: 80,
    'packages/core/src/**': { lines: 100, branches: 95, functions: 100, statements: 100 },
    'apps/api/src/modules/*/domain/**': { lines: 95, branches: 90 },
    'apps/api/src/modules/*/application/**': { lines: 90, branches: 85 },
  },
  exclude: [
    '**/*.module.ts', '**/main.ts', '**/*.d.ts', '**/generated/**',
    '**/prisma/migrations/**', '**/*.stories.tsx', '**/test/**',
  ],
}
```

### 13.2 The three levels

**Unit** — no I/O, no database, no network. Pure functions and entities in isolation. Fast enough to run on save.

| Target          | Tool                          | Notes                                                                                                       |
| --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/core` | Vitest                        | The calendar and grid maths, exhaustively; the DAG helpers against cycles and forward references.           |
| Domain entities | Vitest                        | Every invariant gets a test that proves it _rejects_ the invalid case, not just accepts the valid one.      |
| Use cases       | Vitest + in-memory repo fakes | The repository interface makes fakes trivial. Test the rule, not the SQL.                                   |
| Parsers         | Vitest + fixtures             | Real `teach` output, plus deliberately malformed files proving degradation is graceful.                     |
| LLM layer       | Vitest + recorded fixtures    | **Never hits the live API in CI.** Schema validation, MCQ hygiene validator, cache-breakpoint construction. |

**Integration** — real Postgres, real Storage; no mocks at the boundary.

| Target         | Tool                         | Notes                                                                                                                                                           |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositories   | Vitest + local Supabase      | Migrations applied first. Mappers verified round-trip.                                                                                                          |
| **RLS**        | Vitest + local Supabase      | **Mandatory and non-negotiable: for every table, prove user A cannot read or write user B's rows.** A new table without an RLS test is an incomplete migration. |
| API routes     | Vitest + Nest testing module | Real DI graph, real DB, HTTP in and out. Auth guard included — an unauthenticated request must 401.                                                             |
| Workspace sync | Vitest + local Storage       | Added / modified / deleted / **conflict** — the conflict path especially, since it's the one that can lose work.                                                |

**End to end** — Playwright, real browser, real stack.

| Flow                                                                             | Why it's covered                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Sign up → sign in → sign out                                                     | Auth is the front door.                                         |
| The capture loop: start focus → stop → debrief → appears on today                | The core daily habit; if this breaks, the product is dead.      |
| Generate a lesson → run completes → lesson renders in the sandbox → mark outcome | The agent path, with the model stubbed.                         |
| Offline: go offline → start a session → reconnect → persists exactly once        | Idempotency, which is easy to get wrong and silent when you do. |
| Keyboard-only pass through the capture loop                                      | Accessibility, tested not asserted.                             |

E2E runs against a seeded database with a stubbed Anthropic client — deterministic, no spend, no flake from model variance.

### 13.3 Gates

| When                                 | Runs                                                     | Budget   |
| ------------------------------------ | -------------------------------------------------------- | -------- |
| **On save** (watch)                  | Affected unit tests                                      | instant  |
| **Pre-commit** (husky + lint-staged) | Lint, typecheck, unit tests for staged packages          | < 20s    |
| **Pre-push**                         | Full unit + integration, coverage thresholds             | < 4 min  |
| **CI on PR**                         | Everything: unit, integration, E2E, coverage gate, build | < 12 min |
| **Release**                          | CI green + migrations applied, then deploy               | —        |

**Pre-commit stays fast on purpose.** Putting the full suite there means commits take minutes, and the predictable result is `--no-verify` becoming muscle memory — a gate everyone bypasses is worse than no gate. The coverage floor is enforced at **pre-push and CI**, where a slow honest check is acceptable.

### 13.4 Rules

1. **A bug fix starts with a failing test.** No exceptions — that test is the proof the bug is real and the guard against its return.
2. **A new table without an RLS test is an incomplete migration.** Enforced in review.
3. **Coverage is a floor, not a goal.** 100% of `packages/core` covered by tests that assert nothing is worse than 90% covered by tests that assert the right things. Review tests as carefully as code.
4. **The agent is tested on shape, never content.** Assert files were created, records parse, the run recorded usage. Never assert on lesson text — it's non-deterministic and the assertion will be deleted within a week.
5. **No live API calls in any automated test.** Recorded fixtures and a stubbed client. CI must be free and offline-safe.
6. **Flaky tests are bugs.** Quarantine within a day, fix within a week, never `.skip` and forget.

---

## 14. Environments & deploy

| Env     | Supabase                           | Railway                                |
| ------- | ---------------------------------- | -------------------------------------- |
| local   | Supabase CLI (Docker)              | `pnpm dev` — api, worker, web, lessons |
| preview | Shared staging project             | Railway PR environments                |
| prod    | Dedicated project, PITR backups on | `api`, `worker`, `lessons`             |

### Toolchain and infrastructure decisions

| Decision        | Choice                                                            | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager | **pnpm** workspaces                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Task runner     | **Turborepo**                                                     | Remote caching matters most for the test gate — CI shouldn't re-run untouched packages to prove 80%.                                                                                                                                                                                                                                                                                                                            |
| Node            | **22 LTS**, pinned in `.nvmrc` and `engines`                      |                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CI              | **GitHub Actions**                                                | Gates per §13.3. Turbo cache keyed on lockfile + inputs.                                                                                                                                                                                                                                                                                                                                                                        |
| **Region**      | **Both in `us-east-1`** (Supabase `us-east-1`, Railway `us-east`) | Supabase offers São Paulo (`sa-east-1`) and it's tempting from Brazil — but Railway has no South American region, so choosing it puts the API and the database on different continents. The API↔DB hop is the chatty one (dozens of round trips per request); the browser↔API hop happens once. Co-locating costs you ~120ms of one-time latency and saves you ~120ms × N. **Co-location wins decisively — do not split them.** |
| Hostnames       | `app.<domain>` · `api.<domain>` · **`lessons-<random>.<domain>`** | The lessons origin **must** be a genuinely different host, or the sandbox isolation in §7.5 is decorative. An unguessable subdomain adds a little defence in depth. Domain still to be bought.                                                                                                                                                                                                                                  |
| Secrets         | Railway env vars; `.env.local` from `.env.example` for dev        | The Anthropic key exists only in `api` and `worker`, never in the web build.                                                                                                                                                                                                                                                                                                                                                    |

### Seed data

Two fixture sets, both generated by a script, neither hand-maintained:

- **`pnpm seed:minimal`** — one user, one mission with a three-module curriculum, lessons in three
  states (understood, shaky, unread), four sessions. Enough to click through.
- **`pnpm seed:rich`** — 6 months of synthetic history: two curricula with modules in every state,
  ~90 focus sessions with a realistic weekday distribution (never a Saturday, one dead fortnight),
  and a parked mission. `pnpm seed:report` prints what the tracker functions actually say about it.

The rich set exists because the trackers are unbuildable against an empty database — you cannot
design a year-of-days grid with four data points. Generate it from a fixed seed so it's
reproducible, and keep it out of production by construction (guard on `NODE_ENV`).

- **Migrations** are `prisma migrate` files in `packages/db/prisma/migrations`, applied with `prisma migrate deploy` in a release command before the new revision takes traffic. **RLS policies and any `check` constraints Prisma can't express go in hand-edited SQL inside those migration files** — never clicked into the Supabase dashboard, which is how environments drift. **Write them by hand.** `prisma migrate dev` cannot run in this repo at all — the `profiles.id → auth.users.id` foreign key is a cross-schema reference, and Prisma refuses to introspect past it unless `auth` joins the datasource's `schemas`, which would hand Prisma ownership of tables Supabase owns. Create the directory and the SQL yourself, apply with `migrate deploy`, and prove it with the RLS and integration suites. Anything hand-written is invisible to `schema.prisma` and will not be regenerated: every CHECK constraint and every partial unique index exists only in SQL.
- **Connection pooling:** point Prisma at Supabase's pooler (`DATABASE_URL`, pgbouncer, `?pgbouncer=true&connection_limit=1`) and at the direct connection for migrations (`DIRECT_URL`). Getting this wrong surfaces as prepared-statement errors under load, not at deploy time.
- **Workspace Storage bucket is private.** All access goes through signed URLs minted after an ownership check.
- **Backups:** Postgres PITR via Supabase; Storage bucket versioning on. A lost lesson is unrecoverable creative work.

---

## 14.1 Versioning and changelog

**One version for the whole product**, not per-package. It's a single deployable product with a single user; independent package versions would be bookkeeping with no reader.

- **SemVer** in the root `package.json`, the single source of truth.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, scoped: `feat(focus): …`), already the commit convention in `CLAUDE.md` where requirement IDs are also referenced.
- **`release-please`** on GitHub Actions derives the version bump, writes `CHANGELOG.md`, tags, and opens the release PR. Nothing is versioned by hand.
- **Build metadata** — git SHA, build timestamp, and the applied migration name — is injected at build time and exposed at `GET /v1/health`. When something is wrong in production, "which code and which schema is actually running" is the first question, and it should take one request to answer.
- **Sentry releases** are tagged with the same version so a stack trace maps to a commit.

### In-app changelog

`CHANGELOG.md` is the source; the app renders it. Two surfaces:

- **Settings → What's new** — the full history, searchable.
- **An unobtrusive marker** when there are entries newer than your last-seen version. A single dot on the settings entry, dismissed by opening it. **Not a modal, not a takeover** — an app that interrupts your focus session to announce itself has failed its own thesis.

Entries are written for a reader, not derived raw from commit subjects: `release-please` produces the skeleton and the release PR is where you rewrite it into plain sentences. A changelog nobody can read is a git log with extra steps.

---

## 15. Build phases

**`NORTHSTAR.md` §4 is the authority on sequencing.** M0–M5 are built: M4 is the curriculum
(§3.2b) and M5 is lessons in the product — the sandboxed reader (§7.5), completion with an outcome,
the reference library, and `focus_sessions.lesson_id`. M6 finishes the three trackers and deploys.

---

## 16. Open technical items

1. ~~**Agent SDK API verification**~~ — **done, M3 day one.** §7.3 was verified against
   `@anthropic-ai/claude-agent-sdk@0.3.222`'s own `sdk.d.ts` and rewritten; §7.4's conflict design was
   verified against a live `storage-api v1.60.4`. Two findings changed the design rather than the
   prose: `allowedTools` does not restrict tools, and Supabase Storage has no conditional write. The
   SDK is pinned for the milestone — the CLI version is pinned to the SDK version, so bumping it
   changes agent behaviour and earns its own commit and its own probe run.
2. ~~**Agent run cost and latency**~~ — **measured, M3.** One lesson on a cold workspace:
   **26 turns, 8 minutes, $1.47.** Inside the ~$2 threshold that would have meant the defaults were
   wrong, but not comfortably — a second lesson on a warm workspace should be cheaper (cache reads
   were already 348K tokens against 51K writes) and that is the number to watch next. The output was
   a 26KB lesson, a reference card, a learning record, three shared assets, and an unprompted learner
   memory.

   Two things the measurement changed:

   - **`Skill` must be in `options.tools`.** It is a tool, and `tools` is the base surface — a run
     without it loads the skill, lists it in `init.skills`, and cannot invoke it. The first live run
     did exactly that: 12 turns, $0.27, a competent `RESOURCES.md`, and no lesson. R1 arriving through
     the front door after the frontmatter guard was removed.
   - **Per-assistant-message usage is not billable usage.** The run yielded 18 assistant messages over
     8 distinct ids whose `output_tokens` summed to 121, against a real 6,276. §8.6's `teach_turn`
     rows are therefore near-empty and the `teach_overhead` reconciliation carries ~98% of the cost.
     The invariant still holds — the rows sum to `modelUsage`, so the meter is right — but the
     per-turn split is not the granularity it looks like. See §16.8.

3. **Managed Agents re-evaluation** — if the memory-store model stabilizes out of beta, it deletes §7.4 entirely. Worth a spike after M6.
4. **Lesson asset handling** — the `teach` skill wants a shared `assets/` component library per workspace. Confirm relative-path resolution works through the signed-URL lessons origin; may need path rewriting on serve.
5. **`llm_calls` per-turn granularity is currently fiction.** The rows sum to `modelUsage` so the
   cost total is correct, but the per-`teach_turn` figures are partial-message deltas rather than what
   each turn was billed. Either attribute properly — which may need `includePartialMessages` off and a
   different message to read usage from — or collapse to one row per model per run and stop implying
   a breakdown that is not there. A wrong breakdown is worse than none, because §8.6's stated purpose
   is answering "cost per lesson" and somebody will eventually ask "cost per turn".
6. **Mission slug immutability** — `workspace_key` is a Storage prefix, so renaming a mission must not move files. Set once at first materialisation; the display topic is free to change.
