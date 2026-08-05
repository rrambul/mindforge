# Mindforge — Technical Design

**Status:** Draft v0.1
**Date:** 2026-08-05
**Companion doc:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) — product requirements. Read that first; this document assumes its vocabulary (Mission, Skill, Resource, Lesson, Learning Record, Focus Session, Friction Event, Review Item, Artifact).

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

| Layer          | Choice                                                                          | Notes                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend       | Vite + React + TypeScript                                                       | React over Lit here: the chart/dashboard ecosystem (Recharts/visx) and TanStack Query matter more than shadow-DOM encapsulation for a single-app product.                                  |
| Routing / data | TanStack Router + TanStack Query                                                | Query's cache + optimistic mutations are what make ≤5s capture actually feel instant.                                                                                                      |
| UI             | Tailwind + Radix primitives                                                     | Headless primitives, own the visual design (see `REQUIREMENTS.md` §7.6 — this app needs to feel calm, not templated).                                                                      |
| Charts         | Recharts (or visx if the friction/retention charts get custom)                  |                                                                                                                                                                                            |
| API            | NestJS + Fastify adapter                                                        | Fastify over Express for throughput and better schema integration.                                                                                                                         |
| Validation     | Zod, shared via `packages/core`                                                 | One schema per DTO, reused for API validation, SPA forms, and LLM structured outputs.                                                                                                      |
| DB access      | Prisma ORM                                                                      | Mature migrations, strong TS inference, and the schema doubles as documentation. RLS needs an explicit transaction wrapper (§3.6) — a one-time cost, handled by a Prisma Client extension. |
| Queue          | BullMQ + `@nestjs/bullmq` (Redis on Railway)                                    |                                                                                                                                                                                            |
| Auth           | Supabase Auth (email+password, GitHub OAuth)                                    | SPA holds the session; API verifies the JWT.                                                                                                                                               |
| DB / Storage   | Supabase Postgres + Storage                                                     | RLS on every table. Storage holds teach workspaces.                                                                                                                                        |
| LLM            | `@anthropic-ai/sdk` (API calls), `@anthropic-ai/claude-agent-sdk` (teach agent) | Two different packages, two different jobs — see §7.1.                                                                                                                                     |
| Observability  | Pino → Railway logs; Sentry; a `llm_calls` table for cost                       |                                                                                                                                                                                            |
| Tests          | Vitest (unit + integration), Playwright (E2E)                                   | Matches the patterns you already use.                                                                                                                                                      |

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

**Modules:** `missions` · `goals` · `skills` · `resources` · `focus` · `friction` · `planning` · `teach` · `records` · `review` · `assessments` · `artifacts` · `insights` · `account`.

### Token + wiring convention

```ts
// domain/skill.repository.ts
export const SKILL_REPOSITORY = Symbol("SkillRepository");

export interface SkillRepository {
  findById(userId: UserId, id: SkillId): Promise<Skill | null>;
  listForUser(userId: UserId): Promise<Skill[]>;
  save(userId: UserId, skill: Skill): Promise<void>;
}
```

```ts
// presentation/skills.module.ts
@Module({
  controllers: [SkillsController],
  providers: [
    RecordSkillEvidence,
    GetSkillGraph,
    { provide: SKILL_REPOSITORY, useClass: PrismaSkillRepository },
  ],
  exports: [RecordSkillEvidence], // the worker imports these
})
export class SkillsModule {}
```

### Three decisions this structure forces, all of them good here

**1. `userId` is a required parameter on every repository method.** Not read from an ambient context. This is the structural fix for the risk flagged in §3.6 — the worker bypasses RLS because it uses the service-role key, and with this signature it _cannot_ forget to scope a query. The type system enforces what a code-review checklist otherwise has to.

**2. The worker reuses the API's use cases.** `apps/worker` imports feature modules and calls the same `application/commands/*` classes rather than reimplementing writes against the database. A BullMQ processor becomes a thin adapter: deserialize job → call use case → record result. Business rules live in exactly one place.

**3. LLM and Storage are ports, not imports.** `application/ports/lesson-generator.port.ts` and `storage.port.ts` are interfaces; the Anthropic and Supabase clients are infrastructure adapters behind them. Use cases are then testable without network access, which matters a lot for the agent path.

### Where `packages/core` fits

`packages/core` is **pure calculation with no domain identity** — skill decay curves, FSRS scheduling, calibration math, friction classification, temper-band thresholds. It's a package rather than a domain service because `apps/web` needs the same functions to render a gauge or preview a review schedule without a round trip.

Domain entities _call_ `packages/core`; they don't duplicate it.

```ts
// domain/entities/skill.ts
import { decayedScore, bandFor } from "@mindforge/core";

export class Skill {
  scoreAt(now: Date): Score {
    return decayedScore(this.evidence, this.halfLifeDays, now);
  }
}
```

### Pragmatism

Not every module earns four layers. `artifacts` is close to CRUD — a controller, one use case file, and a repository is enough. **Add layers when there's an invariant to protect, not by default.** The modules that genuinely need the full structure are `skills` (evidence and scoring rules), `teach` (workspace sync and conflict handling), `review` (scheduling), and `assessments` (grading and calibration). Applying the full ceremony to every module turns a good pattern into overhead.

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

**Modules mirror the backend's** — `missions`, `skills`, `focus`, `friction`, `teach`, `review`, `assessments`, `insights` — so a change usually lands in one folder on each side.

### The rules that keep it clean

**1. Server state lives in TanStack Query and is never copied into `useState`.** This is the single biggest cause of unmaintainable React apps: the same data in two places, drifting. If it came from the API, it stays in the query cache; components read it with a hook.

**2. Components never fetch.** Every request goes through a hook in `features/<x>/api/`. A component that imports the http client directly is a bug.

```ts
// features/friction/api/use-log-friction.ts
export function useLogFriction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogFrictionInput) => api.post("/friction", input),
    onMutate: async (input) => {
      // ≤5s capture means optimistic, always
      await qc.cancelQueries({ queryKey: ["friction", "today"] });
      const prev = qc.getQueryData(["friction", "today"]);
      qc.setQueryData(["friction", "today"], (old) => [...old, optimistic(input)]);
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(["friction", "today"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["friction"] }),
  });
}
```

**3. Types and validation come from `packages/core`.** The same Zod schemas the API validates with. No hand-written DTOs, no drift between client and server.

**4. Domain math comes from `packages/core` too.** The temper gauge renders decay with the identical function the API scores with. If the gauge and the API ever disagree about a skill's score, the product's core promise is broken — so there is exactly one implementation.

```tsx
import { decayedScore, confidenceWidth } from "@mindforge/core";

<TemperGauge
  score={decayedScore(skill.evidence, skill.halfLifeDays, now)}
  feather={confidenceWidth(skill.lastEvidenceAt, now)}
/>;
```

**5. Routes are smart, components are dumb.** Route components fetch and compose; everything in `ui/` takes props and renders. Makes the UI layer trivially testable and storybook-able.

**6. Features never import each other.** Cross-feature sharing goes through `shared/`, or is composed at the route level. This is the boundary that stops a 40-file refactor two years in — enforce it with the same ESLint rule as the backend.

**7. `shared/ui` is the design system, not a junk drawer.** The temper gauge, the ratio bar, and the band chips are shared primitives because they appear in five features. Something used once lives in that feature's `ui/`.

### Client state that isn't server state

Very little, and it doesn't need Redux. **Zustand** for two genuinely global, ephemeral concerns:

- **The running focus session** — tick, elapsed, current intention. Global because the timer must survive navigation and be visible from anywhere.
- **The command palette** — open state, and the action registry each feature contributes to.

Everything else is either server state (Query) or local component state (`useState`). If you find yourself reaching for a third store, the data probably belongs in Query.

### Forms

`react-hook-form` + `@hookform/resolvers/zod`, with schemas imported from `packages/core`. The mission editor, the session debrief, and the assessment answer sheet are the only real forms — most capture is one tap and shouldn't be a form at all.

### Offline queue

Lives in `shared/lib/offline-queue.ts`, not in any feature. It wraps mutations for the three capture paths (session start/stop, friction, progress), persists to IndexedDB with client-generated UUIDs, and replays on reconnect. Idempotency is the server's job — the client just retries.

### Testing

| Layer              | Tool                     | What                                                                                       |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| `shared/ui`        | Vitest + Testing Library | Rendering, states, a11y. The temper gauge gets its own suite — feathering is load-bearing. |
| `features/*/api`   | Vitest + MSW             | Query keys, optimistic rollback, error mapping.                                            |
| `features/*/model` | Vitest                   | Pure selectors and derivations.                                                            |
| Routes             | Playwright               | The capture loop end to end.                                                               |

---

## 3. Data model

Postgres. Every user-owned table carries `user_id uuid not null references auth.users(id)` and has RLS enabled. Timestamps are `timestamptz`. IDs are `uuid default gen_random_uuid()`.

### 3.1 Core entities

```sql
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

-- Goals -----------------------------------------------------------------
create table goals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  mission_id   uuid references missions(id) on delete set null,
  title        text not null,
  definition_of_done text,
  target_date  date,
  status       text not null default 'active'
               check (status in ('active','met','missed','abandoned')),
  outcome_note text,                   -- required when status != 'active'
  created_at   timestamptz not null default now()
);

-- A goal is met when all its targets are met. Progress is DERIVED from these,
-- never hand-entered — there is no percentage slider. See §3.8.
create table goal_targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  goal_id    uuid not null references goals(id) on delete cascade,
  kind       text not null check (kind in (
               'resource_progress',  -- finish resource X to N%
               'skill_band',         -- bring skill X to band Y
               'artifact',           -- ship a thing (binary)
               'focus_hours',        -- spend N hours on a mission/skill
               'review_accuracy',    -- hold N% accuracy on skill X
               'lessons_completed',  -- complete N lessons in a mission
               'manual')),           -- you decide; the honest escape hatch
  resource_id uuid references resources(id) on delete cascade,
  skill_id    uuid references skills(id) on delete cascade,
  mission_id  uuid references missions(id) on delete cascade,
  target      jsonb not null,        -- {"percent":100} | {"band":"fluent"}
                                     -- {"hours":40}    | {"accuracy":0.85,"window_days":30}
  weight      numeric(4,2) not null default 1,
  met_at      timestamptz
);

create index goal_targets_goal_idx on goal_targets (user_id, goal_id);

-- Skills ----------------------------------------------------------------
create table skills (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  name           text not null,
  slug           text not null,
  description    text,
  band           text not null default 'aware'
                 check (band in ('aware','assisted','working','fluent','teaching')),
  perceived_level numeric(5,2),        -- self-rating 0-100, stored separately (FR-S2)
  score          numeric(5,2),         -- derived from evidence, NOT self-reported
  score_stddev   numeric(5,2),         -- confidence: score ± ~2σ  (FR-S3)
  half_life_days numeric(6,2) default 90,  -- decay parameter (FR-S4)
  last_evidence_at timestamptz,
  unique (user_id, slug)
);

-- Prerequisite graph (FR-S1). DAG; cycle prevention enforced in app code.
create table skill_edges (
  user_id    uuid not null,
  skill_id   uuid not null references skills(id) on delete cascade,
  prereq_id  uuid not null references skills(id) on delete cascade,
  primary key (skill_id, prereq_id),
  check (skill_id <> prereq_id)
);

-- Every score change traces to an evidence event. Scores are never hand-set.
create table skill_evidence (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  skill_id    uuid not null references skills(id) on delete cascade,
  kind        text not null check (kind in
              ('assessment','review','lesson','artifact','teach_back','self_report')),
  source_id   uuid,                    -- polymorphic; kind determines the table
  raw_score   numeric(5,2) not null,   -- 0-100 for this single observation
  weight      numeric(4,2) not null,   -- artifact 1.0 > teach_back 0.9 > assessment 0.8 …
  occurred_at timestamptz not null default now()
);
```

`skill_evidence` is the heart of scoring. `skills.score` / `score_stddev` are **materialized** from it (recomputed on write and by a nightly job), never edited directly. That single rule is what makes FR-S2 through FR-S5 hold.

### 3.2 Resources, lessons, records

```sql
create table resources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  type        text not null check (type in
              ('book','podcast','article','video','course','docs','paper')),
  title       text not null,
  author      text,
  url         text,
  status      text not null default 'inbox' check (status in
              ('inbox','queued','active','finished','abandoned','reference')),
  abandon_reason text,                 -- guilt-free, and prime friction data (FR-R5)
  -- Type-specific progress, one column, validated per type in app code
  progress    jsonb not null default '{}'::jsonb,
              -- book:    {"unit":"page","current":137,"total":590}
              -- podcast: {"unit":"seconds","current":1420,"total":3900}
              -- article: {"unit":"percent","current":100}
  trust       text check (trust in ('high','medium','low')),  -- RESOURCES.md parity
  rejected_reason text,                -- teach's "Explored But Rejected" list
  added_at    timestamptz not null default now(),
  finished_at timestamptz
);

create table resource_links (          -- resource ↔ mission / skill
  resource_id uuid not null references resources(id) on delete cascade,
  user_id     uuid not null,
  mission_id  uuid references missions(id) on delete cascade,
  skill_id    uuid references skills(id) on delete cascade
);

-- Notes attach to anything. A highlight is just a note with a quote and a locator,
-- so there is one table, not two. See §3.7 for why this isn't a note-taking app.
create table notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  subject_type text not null check (subject_type in (
                 'mission','goal','skill','resource','lesson','reference_doc',
                 'learning_record','focus_session','assessment','artifact','standalone')),
  subject_id   uuid,                    -- null only when subject_type = 'standalone'
  body         text not null,           -- markdown
  quote        text,                    -- the excerpt this responds to → a highlight
  locator      jsonb,                   -- {"page":204} | {"seconds":1420} | {"selector":"#h3"}
  pinned       boolean not null default false,
  promoted_review_item_id uuid references review_items(id) on delete set null,
  -- Search stemming follows the CONTENT's language, not the UI locale (§5.2).
  lang         text not null default 'english' check (lang in ('english','portuguese')),
  search       tsvector generated always as (
                 to_tsvector(
                   case lang when 'portuguese' then 'portuguese'::regconfig
                             else 'english'::regconfig end,
                   coalesce(quote,'') || ' ' || body)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (subject_id is not null or subject_type = 'standalone')
);

create index notes_subject_idx on notes (user_id, subject_type, subject_id, created_at desc);
create index notes_search_idx  on notes using gin (search);

-- Index over workspace files. Rebuildable — files in Storage are canonical.
create table lessons (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  mission_id   uuid not null references missions(id) on delete cascade,
  seq          integer not null,        -- 0001, 0002 … from the filename
  slug         text not null,
  title        text not null,
  storage_path text not null,           -- workspaces/<u>/<m>/lessons/0007-x.html
  content_hash text not null,
  completed_at timestamptz,
  outcome      text check (outcome in ('understood','shaky','lost')),
  unique (mission_id, seq)
);

create table reference_docs (           -- teach's ./reference/*.html (FR-T5)
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
  next         text,                    -- feeds the ZPD recommender (FR-T7)
  supersedes_id uuid references learning_records(id),
  recorded_at  timestamptz not null default now(),
  unique (mission_id, seq)
);
```

### 3.3 Attention and friction

```sql
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null,
  mission_id  uuid references missions(id) on delete set null,
  goal_id     uuid references goals(id) on delete set null,
  resource_id uuid references resources(id) on delete set null,
  lesson_id   uuid references lessons(id) on delete set null,
  status      text not null default 'todo'
              check (status in ('todo','doing','done','dropped')),
  estimate_minutes integer,
  reschedule_count integer not null default 0,   -- avoidance signal (FR-C5)
  created_at  timestamptz not null default now()
);

create table focus_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  task_id        uuid references tasks(id) on delete set null,
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
  entry_mode     text not null default 'timer'
                 check (entry_mode in ('timer','manual','backfilled')),  -- FR-F2
  created_at     timestamptz not null default now()
);

create table friction_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  session_id  uuid references focus_sessions(id) on delete cascade,
  task_id     uuid references tasks(id) on delete set null,
  skill_id    uuid references skills(id) on delete set null,
  resource_id uuid references resources(id) on delete set null,
  type        text not null check (type in (
                'interruption','self_interruption','too_hard','too_easy',
                'unclear_material','tooling','missing_prerequisite',
                'decision_fatigue','avoidance','physical','productive_struggle')),
  intensity   smallint not null check (intensity between 1 and 5),
  note        text,
  occurred_at timestamptz not null default now()
);

-- Weekly allocation: planned hours per mission/skill (FR-F5)
create table weekly_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  week_start date not null,             -- Monday, user's timezone
  unique (user_id, week_start)
);

create table weekly_allocations (
  plan_id    uuid not null references weekly_plans(id) on delete cascade,
  user_id    uuid not null,
  mission_id uuid references missions(id) on delete cascade,
  skill_id   uuid references skills(id) on delete cascade,
  planned_minutes integer not null,
  primary key (plan_id, mission_id, skill_id)
);
```

**Index note:** `friction_events` and `focus_sessions` are the analytics hot path. Index `(user_id, occurred_at desc)` and `(user_id, mission_id, occurred_at desc)` on both, plus `(user_id, type, occurred_at desc)` on friction.

### 3.4 Retention and assessment

```sql
create table review_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  skill_id    uuid references skills(id) on delete set null,
  mission_id  uuid references missions(id) on delete set null,
  kind        text not null check (kind in ('cloze','recall','explain','task')),
  front       text not null,
  back        text,
  source      text check (source in
              ('lesson','highlight','learning_record','assessment','manual')),
  source_id   uuid,
  -- FSRS state
  stability   numeric(8,3),
  difficulty  numeric(6,3),
  due_at      timestamptz not null default now(),
  reps        integer not null default 0,
  lapses      integer not null default 0,
  suspended   boolean not null default false
);

create table review_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  item_id      uuid not null references review_items(id) on delete cascade,
  rating       smallint not null check (rating between 1 and 4),  -- again/hard/good/easy
  elapsed_ms   integer,
  reviewed_at  timestamptz not null default now(),
  scheduled_days numeric(8,3),
  prev_stability numeric(8,3)
);

create table assessments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  skill_id    uuid not null references skills(id) on delete cascade,
  target_band text not null,
  kind        text not null check (kind in ('baseline','periodic','ad_hoc','teach_back')),
  generated_by_model text,
  status      text not null default 'draft'
              check (status in ('draft','ready','in_progress','scored','discarded')),
  score       numeric(5,2),
  calibration_gap numeric(5,2),        -- mean(confidence) - mean(correctness)  (FR-X3)
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

create table assessment_questions (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references assessments(id) on delete cascade,
  user_id        uuid not null,
  position       integer not null,
  format         text not null check (format in
                 ('mcq','short_answer','explain','applied','spot_the_bug','scenario')),
  prompt         text not null,
  options        jsonb,                 -- MCQ only; equal-length enforced (FR-X6)
  correct        jsonb,
  rationale      text,
  cites          jsonb,                 -- lesson/reference/resource ids grounding it
  -- Response
  answer         jsonb,
  confidence     smallint check (confidence between 1 and 5),  -- BEFORE reveal
  correctness    numeric(4,3),          -- 0..1, graded (auto or model)
  flagged        boolean not null default false,   -- bad question (FR-X7)
  flag_reason    text
);

create table artifacts (               -- the "wisdom" pillar (FR-W1..W3)
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  skill_id    uuid references skills(id) on delete set null,
  mission_id  uuid references missions(id) on delete set null,
  kind        text not null check (kind in
              ('pr','project','talk','post','conversation','class','other')),
  title       text not null,
  url         text,
  reflection  text,
  occurred_at date not null,
  created_at  timestamptz not null default now()
);
```

### 3.5 Operational tables

```sql
create table agent_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  mission_id  uuid references missions(id) on delete cascade,
  kind        text not null check (kind in
              ('generate_lesson','sync_workspace','generate_assessment',
               'grade_teach_back','weekly_digest','generate_plan')),
  status      text not null default 'queued'
              check (status in ('queued','running','succeeded','failed','cancelled')),
  job_id      text,
  input       jsonb,
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz
);

create table llm_calls (               -- cost + cache-hit observability (§9.4)
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
-- otherwise scan raw sessions. Rebuilt nightly per user timezone, and on write.
create table daily_activity (
  user_id          uuid not null,
  day              date not null,          -- in the user's timezone, not UTC
  focus_minutes    integer not null default 0,
  session_count    integer not null default 0,
  ember_minutes    integer not null default 0,
  slag_minutes     integer not null default 0,
  reviews_done     integer not null default 0,
  reviews_correct  integer not null default 0,
  lessons_completed integer not null default 0,
  notes_captured   integer not null default 0,
  resources_touched integer not null default 0,
  artifacts_logged integer not null default 0,
  primary key (user_id, day)
);

create table workspace_files (         -- sync ledger; see §7.4
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

- **`api`** — forwards the caller's JWT so `auth.uid()` resolves. Prisma has no built-in hook for this, so it's a **Prisma Client extension** that wraps every operation in a transaction and sets the claim first:

  ```ts
  // packages/db/src/rls.ts
  export const withRls = (prisma: PrismaClient, claims: string) =>
    prisma.$extends({
      query: {
        $allOperations: ({ args, query }) =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw`select set_config('request.jwt.claims', ${claims}, true)`;
            return query(args);
          }),
      },
    });
  ```

  A request-scoped Nest provider builds the extended client once per request from the verified JWT; repositories inject _that_, never the raw client. **`set_config(..., true)` is transaction-local** — the `true` matters. Without it the setting leaks across pooled connections and one user's claims apply to another's query.

  Note this makes every operation a transaction, which is a real (small) cost. Batch reads in a single `$transaction` where it matters.

- **`worker`** — has no request context. It uses the service-role key **and therefore bypasses RLS**. Every worker query must filter `user_id` explicitly. Enforce this with a lint rule and a code-review checklist item; it is the single most likely place a cross-user leak appears.

---

### 3.7 Notes — and why this isn't a note-taking app

`REQUIREMENTS.md` §4 lists "being a note-taking app" as a non-goal, and that stands. The distinction is not how much you can write; it's what the writing is _for_.

**Notes here are inputs to the system, not an archive.** Four things make that true, and they're the reason the feature earns its place rather than duplicating Obsidian:

1. **Every note is attached to something** the app already models — a resource, a skill, a lesson, a focus session. There are no free-floating documents except the deliberate `standalone` escape hatch.
2. **Notes feed lesson generation.** Notes on a mission's skills and resources are summarised into `BRIEFING.md`, so what you wrote while reading shapes what you're taught next. This is the single strongest argument for keeping notes in-app rather than in Obsidian.
3. **Any note promotes to a review item in one tap.** A thought you had while reading becomes something you're tested on. That's the bridge from consumption to retention (FR-R4), now available from every subject type, not just book highlights.
4. **Notes are searchable, and that's the whole retrieval story.** Postgres full-text over quote + body. **No backlinks, no `[[wikilinks]]`, no graph view, no daily notes.** Those are what turn a notes feature into a second product, and they are explicitly out of scope.

**Capture cost is the constraint, as everywhere else.** A note during a running focus session is one tap from the session bar — the note is auto-attached to that session and, through it, to the task and mission. No picker, no filing.

**Workspace sync.** Notes on a mission's subjects are written into `notes/` inside that mission's teaching workspace as Markdown, so the agent reads them with ordinary file tools and they survive outside the app. They do **not** go into `NOTES.md` — that file belongs to the `teach` skill as _its_ scratchpad for teaching preferences, and mixing the two would corrupt a contract we don't own.

### 3.8 Goal progress

**Progress is computed, never entered.** There is no percentage field and no slider — that would be self-report wearing a number's clothes, and it's the exact failure mode `REQUIREMENTS.md` §7.2 exists to prevent.

Each target kind has one derivation, all of them pure functions in `packages/core`:

| Kind                | Progress =                                                                 | Met when                                                                                                  |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `resource_progress` | `resource.progress.current / total`                                        | reaches the target percent                                                                                |
| `skill_band`        | ordinal distance from the skill's band at goal creation to the target band | the **decayed** score sits in the target band — so a goal can un-meet itself, which is correct and honest |
| `artifact`          | 0 or 1                                                                     | a linked artifact exists                                                                                  |
| `focus_hours`       | `sum(focus minutes since goal start) / target`                             | reaches the target                                                                                        |
| `review_accuracy`   | rolling accuracy over the window                                           | at or above target across the window                                                                      |
| `lessons_completed` | `completed / target`                                                       | reaches the target                                                                                        |
| `manual`            | 0 or 1                                                                     | you mark it                                                                                               |

**Goal progress** is the weighted mean of its targets. A goal with no targets shows _"no targets — progress can't be measured"_ rather than 0% or 100%; that message is the nudge to add one.

**Projection.** Pace comes from the target's own underlying series over a trailing window (default 21 days), extrapolated linearly to the target date. Stated plainly and without optimism (FR-P3):

> _"At your last three weeks' pace this finishes 5 weeks late. Cut scope or add 2h/week."_

Where pace is zero, say so — _"no progress in 21 days; no completion date"_ — rather than projecting infinity or hiding the row.

**Recomputation** happens on the nightly `scores:recompute` job and on any write that touches a target's source. Because `skill_band` depends on decay, goal progress moves without you doing anything — which is the point.

### 3.9 The activity grid

A year of days as a heatmap — the familiar shape, deliberately not the familiar semantics.

**GitHub's grid encodes one thing: volume. Darker is more, more is better.** For this product that's exactly wrong — a dark day of thrashing on broken tooling would render as your best week. Volume is the vanity metric the whole thesis rejects.

So the cell carries two dimensions:

| Channel                 | Encodes                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| **Intensity** (opacity) | Total focus minutes that day                                          |
| **Hue**                 | Ember share — productive friction as a fraction of the day's friction |

A heavy, grey-slag cell reads as _"you spent a lot and got little."_ A heavy ember cell reads as real work. An empty cell is neutral — no shading of shame, because rest days are part of the design.

**Layers.** The same grid, switchable: focus time (default), reviews completed, lessons completed, notes captured, artifacts shipped. Cadence patterns are what the grid is genuinely good at surfacing — _"you have never once logged a Saturday"_ is a fact about your life your weekly plan should probably respect.

**Consistency, not streaks.** No counter that resets to zero and shames you. The figure alongside the grid is **active days in the last 28** — it degrades gracefully, recovers naturally, and can't be broken by one bad week. (`REQUIREMENTS.md` FR-N5.)

**It has to name an action**, like every other insight. The grid ships with one derived line beneath it, and only when there's something real to say:

> _"Your last four weeks average 3.2 active days. Your weekly plans assume 5."_

**Implementation.** Reads `daily_activity` only — never raw sessions. 365 rows per user, so the whole year is one indexed query and the grid is instant. Mobile shows a 12-week window that scrolls horizontally in its own container; the full year is desktop.

---

## 4. Auth

- **Supabase Auth** issues the JWT. SPA holds the session via `@supabase/supabase-js` and refreshes it; the API never issues tokens.
- **`SupabaseAuthGuard`** (Nest) verifies the JWT signature against Supabase's JWKS, extracts `sub` → `userId`, attaches it to the request. Applied globally with an `@Public()` decorator escape hatch.
- **Providers:** email + password (with verification and reset, both handled by Supabase) and GitHub OAuth. GitHub also sets you up for the v2 artifact integration (FR-W4) with no second auth flow.
- **Data export** (FR-A4): a worker job that streams every table filtered by `user_id` to JSON, plus the raw workspace files as Markdown/HTML, zipped to a signed Storage URL that expires in 24h.
- **Account deletion:** `on delete cascade` from `auth.users` covers Postgres; a worker job deletes the Storage prefix. Both must run, and deletion is confirmed only after both succeed.

---

## 5. Frontend notes

- **Optimistic everything for capture.** Start-timer, log-friction, and mark-progress mutations write to the TanStack Query cache immediately and reconcile on response. This is the implementation of the ≤5s / ≤2-tap budget (`REQUIREMENTS.md` §7.1) — a capture that waits on a round-trip has already failed it.
- **Offline queue.** Friction events and session start/stop are queued in IndexedDB when offline and flushed on reconnect. They carry client-generated UUIDs so replay is idempotent. This matters more than full offline support: losing a friction log because you were on the subway kills trust in the data.
- **Command palette (⌘K)** as the primary navigation and capture surface **on desktop**. For this app specifically it's the right shape — "start focus on X", "log friction: tooling", "add article <url>" are all one keystroke plus a few characters. It is not the mobile answer; see §5.1.
- **Live session state** over SSE from the API, so a timer running on your laptop is visible on your phone.
- **PWA** with a service worker for install + offline shell. Not a native app (`REQUIREMENTS.md` non-goals).

---

## 5.1 Mobile

**Mobile-first for capture and review; desktop-first for analysis and authoring.** That split is the design, not a compromise — and it follows from where each activity actually happens.

| Surface                              | Primary target          | Why                                                                                                                 |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Focus timer (start / stop / debrief) | **Mobile**              | You start focusing away from the desk as often as at it.                                                            |
| Friction logging                     | **Mobile**              | It happens mid-session, one-handed, often while annoyed. This is the single most mobile interaction in the product. |
| Review queue                         | **Mobile**              | Ten minutes in a queue, on a train, standing up. Genuinely better on a phone than a laptop.                         |
| Resource capture + progress          | **Mobile**              | You finish a chapter in bed and update it there. Share-target is the v2 form of this.                               |
| Lessons                              | **Both**                | Must read well on a phone — see the agent constraint below.                                                         |
| Weekly planning grid                 | Desktop                 | Allocating hours across missions needs width.                                                                       |
| Insights & charts                    | Desktop                 | Comparison needs pixels. Mobile gets a reduced set, not a squeezed one.                                             |
| Galaxy (M7)                          | Desktop, mobile-capable | Pinch-zoom and tap; the full overview needs a big screen to be worth anything.                                      |
| Mission editing, memory review       | Desktop                 | Long-form writing.                                                                                                  |

### What this actually requires

- **Touch targets ≥44×44px** on every capture control. The friction chips are the ones most likely to be drawn too small.
- **Thumb-zone layout.** Primary actions live at the _bottom_ on mobile, not the top. When a focus session is running, a persistent bottom bar carries stop + the friction chips — reachable one-handed without navigating.
- **A mobile capture affordance that isn't the command palette.** A bottom sheet with the same actions, opened from a single persistent button. Same action registry, different surface.
- **Swipe ratings in the review queue** (again / hard / good / easy), with tap targets as the accessible equivalent — never swipe-only.
- **`dvh`, not `vh`.** iOS Safari's dynamic toolbar makes `100vh` wrong; a timer screen that scrolls under the URL bar looks broken.
- **`env(safe-area-inset-*)`** on the bottom bar, or it sits under the home indicator.
- **Offline matters most here.** The IndexedDB queue exists primarily for mobile — the subway case is the realistic one.
- **PWA install** for standalone display and, on iOS, because notifications require it.
- **Charts get mobile variants**, not squeezed desktop ones. A 12-week friction trend becomes a 4-week sparkline; the full comparison stays desktop.
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

| Setting                              | Controls                                                             | Default                                         |
| ------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| **UI locale** (`en`, `pt-BR`)        | Interface strings, date/number formatting                            | Browser `Accept-Language`, then user preference |
| **Timezone** (IANA)                  | Every "day", "week", nightly job, and the activity grid              | Browser-detected, user-editable                 |
| **Content language** (`en`, `pt-BR`) | The language the agent writes lessons, assessments, and briefings in | Follows UI locale, **separately overridable**   |

That third axis is the one worth having. A Brazilian engineer learning distributed systems will very reasonably want a **pt-BR interface and English lessons**, because the source material, the vocabulary, and the community are all English. Forcing lessons into the UI language would make the product worse. Store it as its own preference.

Search stemming follows a fourth thing: **the language of the content itself** (`notes.lang`), because a note written in Portuguese needs the Portuguese stemmer regardless of what the UI is showing.

### Implementation

- **`react-i18next` + ICU MessageFormat**, namespaced per feature (`missions`, `focus`, `friction`…), lazy-loaded with the route. Translation files live at `apps/web/src/locales/{en,pt-BR}/<namespace>.json`.
- **`Intl` for everything formattable** — `DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `ListFormat`. Never hand-format a date or concatenate a sentence.
- **Enum values are keys, never display text.** The database stores `tooling`, `productive_struggle`, `fluent`; the UI translates at render. This is already how the schema is written — keep it that way.
- **Server-side strings** (emails, export filenames, notification copy) get their own bundle in `packages/core`, resolved from the user's stored locale, not a request header.
- **`lang` and `dir` on `<html>`** set from the active locale.

### The domain glossary is the hard part

Ember, slag, temper bands, friction types, and the score vocabulary are **product concepts, not UI chrome**. Translating them ad-hoc per string guarantees drift — the same term rendered three ways across three screens.

Translate the glossary once, in one file, and derive every usage from it:

| en                                             | pt-BR                                                 | Note                                                                                |
| ---------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Ember                                          | Brasa                                                 | Productive friction                                                                 |
| Slag                                           | Escória                                               | The correct metallurgical term, and it carries the same "worthless byproduct" sense |
| Temper                                         | Têmpera                                               |                                                                                     |
| Aware / Assisted / Working / Fluent / Teaching | Ciente / Assistido / Praticando / Fluente / Ensinando | Band names — needs a native read before it's final                                  |
| Mission                                        | Missão                                                |                                                                                     |
| Focus session                                  | Sessão de foco                                        |                                                                                     |
| Frontier                                       | Fronteira                                             | The unlit ring in the galaxy                                                        |

Band names especially deserve a native speaker's judgement rather than a literal translation — _Praticando_ for "Working" is a guess that reads better than _Trabalhando_ but should be confirmed.

### Locale-sensitive behaviour that isn't a string

- **Week start.** pt-BR convention is Sunday, en-GB is Monday. The weekly plan grid and every "this week" rollup depend on it — so it is a **user preference seeded from locale**, not derived from it at render time. Store it on the profile; `weekly_plans.week_start` must agree with it.
- **Duration formatting.** `6h 20m` vs `6h20`. One helper in `packages/core`, never inline.
- **Decimal separator** in every score, ratio, and confidence interval — `74 ±4` renders differently. `Intl.NumberFormat`, always.

### Agent and model output

- **`BRIEFING.md` states the content language**, so the teach agent writes lessons in it.
- **Assessment generation and grading** carry the same instruction — and grading must accept an answer written in the content language, which the model handles natively as long as it's told.
- **Lesson HTML gets a `lang` attribute** matching the content language, which also fixes hyphenation and screen-reader pronunciation.

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
│  RUNNING SESSION  (only while one is live) │  elapsed · intention ·
│                                            │  friction chips · Stop
├────────────────────────────────────────────┤
│  DUE NOW                                   │  "3 reviews · 12 min"  → one tap
├────────────────────────────────────────────┤
│  NEXT                                      │  the current study-plan step,
│                                            │  or the ZPD candidate, or the
│                                            │  in-progress resource
│                                            │  [ Start focus ]  ← primary
├────────────────────────────────────────────┤
│  THIS WEEK                                 │  planned vs actual, one bar
│                                            │  ember/slag split, one bar
├────────────────────────────────────────────┤
│  ONE THING                                 │  a single derived line, only
│                                            │  when there's something true
│                                            │  and actionable to say
└────────────────────────────────────────────┘
```

**Rules for this screen:**

- **No greeting, no date header, no motivational copy.** The first pixel is information.
- **At most one primary action.** Start focus. Everything else is a link.
- **"One thing" shows nothing rather than filler.** If there's no honest insight today, the block is absent. A daily insight that's manufactured to fill space trains you to stop reading it.
- On mobile the running-session block becomes the **persistent bottom bar** (§5.1) and the rest scrolls beneath it.

### First run

You sign up into an empty account: no missions, no skills, no resources. That's where most personal tools lose people.

**The answer is a guided first mission, not a tutorial.** You learn the app by using it on something you actually want to learn — and it produces real rows, not demo data you'll have to delete.

Four steps, skippable at any point, resumable from a banner:

| Step                                             | Produces                                                    | Why it's this one                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. _What do you want to get better at, and why?_ | A **Mission**                                               | The `teach` skill's whole philosophy grounds on the "why". Asking it first is not onboarding fluff — it's the thing every later feature reads. |
| 2. _What would it look like to have got there?_  | A **Goal** with one typed target                            | Teaches that goals are measured, not declared.                                                                                                 |
| 3. _What are you learning from right now?_       | A **Resource**                                              | Usually a paste of one URL — the cheapest possible win.                                                                                        |
| 4. _Do 15 minutes on it now._                    | A **Focus Session** with intention + debrief + any friction | The habit is the product. Ending the tour inside the core loop is the point.                                                                   |

**Deliberately not in first run:** skills, prerequisite edges, weekly plans, the friction taxonomy. Those are learned by encountering them. And **no questionnaire about how you learn** — those answers are usually wrong, and the learner memory (§7.6) is designed to be populated from behaviour instead.

The empty state on every other screen names one action and links to it. Never an illustration and a shrug.

### The friction chip problem

Eleven friction types (FR-C1) and a one-tap budget (§7.1) are in direct conflict. Eleven chips is not a one-tap UI, especially at 375px.

**Resolution — a ranked four, plus more:**

- Show **four chips**: your three most-used types over the last 30 days, plus **Productive struggle**, which is pinned permanently. It's pinned because it's the one people under-report and the one the product most needs — nobody volunteers "this was hard in a good way" unless it's in front of them.
- A **More** control opens the full eleven in a bottom sheet.
- Intensity defaults to **3** and is never asked for inline. You can adjust it later from the session debrief, where you have the time.
- Cold start, before there's usage data: _Interruption · Tooling · Too hard · Productive struggle_.

So logging friction is one tap in the common case and two in the tail — which meets the budget honestly rather than by pretending eleven chips fit.

### Parked missions

Parking is not archiving, and the semantics have to be explicit or the review queue quietly rots.

| Behaviour                | Parked mission                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skill decay              | **Continues.** Skills don't know your mission is parked, and pretending otherwise would be the exact dishonesty the product exists to avoid.                       |
| Review items             | **Suspended by default**, with a one-tap "keep reviewing" per mission. Otherwise a parked mission floods a queue you can't act on — the Anki death spiral (FR-V6). |
| Decay warnings           | Silenced.                                                                                                                                                          |
| Weekly plan              | Excluded from allocation; excluded from plan-vs-actual.                                                                                                            |
| Activity grid & insights | **Still counted.** History is history.                                                                                                                             |
| Goals                    | Frozen — no missed-deadline nagging, and `target_date` stops projecting.                                                                                           |
| Galaxy (M7)              | Rendered dimmer, not hidden. Parked knowledge is still knowledge.                                                                                                  |

**Unparking restores reviews with their real due dates**, which means an immediately large queue. Say so before unparking, and offer to reschedule the backlog across two weeks instead of dumping it.

---

## 6. API surface

NestJS modules, one per bounded context. REST with Zod-validated DTOs from `packages/core`.

| Module        | Key routes                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missions`    | `GET/POST /missions`, `PATCH /missions/:id` (revision recorded on mission-field change), `POST /missions/:id/park`                                                                     |
| `goals`       | CRUD + `POST /goals/:id/close` (requires `status` + `outcome_note`)                                                                                                                    |
| `skills`      | CRUD, `GET /skills/graph`, `GET /skills/:id/evidence`, `POST /skills/:id/self-rating`                                                                                                  |
| `resources`   | CRUD, `POST /resources/capture` (URL → metadata, §8.5), `PATCH /resources/:id/progress`, `POST /resources/:id/abandon`                                                                 |
| `highlights`  | CRUD, `POST /highlights/:id/promote` → creates a `review_item`                                                                                                                         |
| `focus`       | `POST /focus/sessions/start`, `POST /:id/stop`, `POST /:id/debrief`, `POST /focus/sessions` (manual/backfill), SSE `GET /focus/live`                                                   |
| `friction`    | `POST /friction` (single tap), `GET /friction/summary`                                                                                                                                 |
| `planning`    | `GET/PUT /plans/:weekStart`, `GET /plans/:weekStart/actual`, `POST /reviews/weekly`                                                                                                    |
| `teach`       | `POST /missions/:id/lessons/generate` → enqueues, `GET /agent-runs/:id` (SSE progress), `POST /missions/:id/sync`, `GET /lessons`, `GET /reference-docs`, `POST /lessons/:id/complete` |
| `records`     | `GET/POST /learning-records`                                                                                                                                                           |
| `review`      | `GET /review/queue`, `POST /review/:itemId/answer`                                                                                                                                     |
| `assessments` | `POST /assessments/generate`, `GET /assessments/:id`, `POST /assessments/:id/answer`, `POST /assessments/:id/submit`, `POST /questions/:id/flag`                                       |
| `artifacts`   | CRUD                                                                                                                                                                                   |
| `insights`    | `GET /insights/focus`, `/friction`, `/learning`, `/consumption-vs-retention`, `/backlog`                                                                                               |
| `account`     | `POST /account/export`, `DELETE /account`                                                                                                                                              |

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

- **Idempotency.** Capture endpoints (`POST /focus/sessions/start`, `POST /friction`, `POST /notes`) accept a client-generated UUID as the resource id and are upserts. This is what makes the offline queue safe to replay — retries are free, and the client never has to reason about whether a request landed.
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
  RESOURCES.md
  NOTES.md
  lessons/0001-<slug>.html
  reference/<slug>.html
  learning-records/0001-<slug>.md
  assets/style.css, quiz.js, …
```

Because the layout is byte-identical to a local teaching workspace, `mindforge pull <mission>` / `push` (a small CLI, v2) makes the round trip to local `/teach` trivial. Design for it now; build it later.

### 7.3 The agent worker

```ts
// apps/worker/src/teach/generate-lesson.processor.ts   — SHAPE, not verified API
@Processor("teach")
export class GenerateLessonProcessor {
  async process(job: Job<GenerateLessonInput>) {
    const { userId, missionId } = job.data;
    const run = await this.runs.markRunning(job.data.agentRunId);
    const dir = await this.workspace.materialize(userId, missionId); // Storage → /tmp/ws/<id>

    try {
      // Pre-computed context so the agent starts warm instead of re-deriving state.
      await this.workspace.writeBriefing(dir, await this.zpd.briefing(userId, missionId));

      const result = await query(
        "Teach me the next thing. Read BRIEFING.md first — it has my current " +
          "zone of proximal development, weak skills, and review items that are due.",
        {
          cwd: dir,
          // Skill files are copied into the workspace so the agent loads them
          // exactly as Claude Code would locally.
          allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"],
          // No Bash: the agent has no business running shell commands here.
          model: "claude-opus-5",
          maxTurns: 40,
          abortSignal: AbortSignal.timeout(15 * 60_000),
        },
      );

      const changes = await this.workspace.sync(userId, missionId, dir); // §7.4
      await this.indexer.reindex(userId, missionId, changes);
      await this.runs.succeed(run.id, { changes, usage: result.usage });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
```

**Design points:**

- **`BRIEFING.md` is the ZPD bridge (FR-T7).** Generated fresh each run from learning records, skill-graph gaps, due review items, and recent friction. It's a workspace file, so the agent reads it with the same tools it reads everything else — no special protocol. It's regenerated (not appended) every run and excluded from sync-back.
- **No `Bash` tool.** The `teach` skill mentions opening lessons via CLI; that's a local nicety with no server equivalent. Withholding Bash meaningfully shrinks the blast radius of a compromised or confused run.
- **Hard timeout and turn cap**, both surfaced in `agent_runs`. A runaway agent is a cost incident.
- **One run per mission at a time**, enforced with a BullMQ job key. Two concurrent runs on the same workspace is the fastest route to a corrupt sync.
- **Ephemeral disk.** Railway containers have ephemeral filesystems, which is exactly right here: materialize → run → sync → delete. Never rely on disk surviving a deploy.

### 7.4 Sync protocol (files ↔ Postgres)

Files are canonical. Postgres is a rebuildable index. `workspace_files` is the ledger that makes the diff cheap and conflicts detectable.

**Materialize (Storage → disk):**

1. List the Storage prefix, download every object into `/tmp/ws/<runId>/`.
2. Record `content_hash` (sha256) per file as the **baseline**.

**Sync back (disk → Storage):**

1. Walk the directory, hash every file.
2. Compare to baseline: `added` / `modified` / `deleted` / `unchanged`.
3. For each changed file, check that Storage's current ETag still matches what we downloaded. A mismatch means someone else wrote in between → **conflict**.
4. Upload changed files; delete removed ones; update `workspace_files`.

**Conflicts are surfaced, never resolved silently.** On mismatch the run is marked `succeeded_with_conflicts`, both versions are retained (the incoming write lands at `<path>.conflict-<timestamp>`), and the UI shows a resolution screen. Losing a lesson to a silent overwrite would be unforgivable in an app about learning.

**Reindex** parses the changed files into Postgres:

| File                         | Parsed into                             | Parser                                          |
| ---------------------------- | --------------------------------------- | ----------------------------------------------- |
| `MISSION.md`                 | `missions` + `mission_revisions`        | Headed-section Markdown per `MISSION-FORMAT.md` |
| `RESOURCES.md`               | `resources` (+ trust, rejected list)    | Markdown tables                                 |
| `learning-records/NNNN-*.md` | `learning_records`                      | Sections per `LEARNING-RECORD-FORMAT.md`        |
| `lessons/NNNN-*.html`        | `lessons` (title from `<title>`/`<h1>`) | Cheerio                                         |
| `reference/*.html`           | `reference_docs`                        | Cheerio                                         |

**Parse defensively.** The `teach` skill's formats are a contract you don't control; a format change must degrade to "file stored, partially indexed", never "run failed" and never "content lost". Every parser returns `{ parsed, warnings[] }` and warnings surface in the run result.

### 7.5 Serving lesson HTML safely

Lessons are **LLM-authored HTML with inline JavaScript** (quizzes, simulators). Treating them as trusted would be a serious mistake.

- Served from a **separate origin** (`lessons.<domain>`) by the tiny `lessons` service. Different origin means a lesson can't touch the app's cookies, `localStorage`, or Supabase session even if everything else fails.
- Rendered in `<iframe sandbox="allow-scripts allow-popups">`. **Never add `allow-same-origin`** — combined with `allow-scripts` it lets the frame remove its own sandbox attribute and defeats the whole mechanism.
- Response CSP on the lessons origin: `default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors https://<app-domain>`. `connect-src 'none'` means a lesson cannot exfiltrate anything.
- The lessons service authenticates via short-lived signed URLs minted by the API after an RLS-checked ownership test. It never trusts a path from the client — the path is resolved from the lesson row.
- Lesson → app communication (completion, quiz results) goes over `postMessage` with a strict `origin` check on the parent side and a schema check on the payload. Never `eval` or trust structure.
- Relative links (`../reference/x.html`, `./assets/style.css`) work because the service serves the whole workspace tree — which is exactly why per-request ownership checks on the path prefix are non-negotiable.

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

**Also feeds non-agent calls.** The memory summaries are prepended to the cached system prefix (§8.4) for assessment generation and grading, so a model grading your answer knows you're an engineer who explains in code, not prose.

**Bootstrapping:** empty at signup. The agent populates it from the first few sessions; the user can also write entries directly. Don't build an onboarding questionnaire — the answers people give up front about how they learn are usually wrong.

---

## 8. LLM layer

All non-agent model calls go through `packages/llm` — no module calls the Anthropic SDK directly. That's what makes cost tracking, caching, and model swaps a one-file change.

### 8.1 Model selection

| Job                                                    | Model                                 | Why                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lesson generation (agent)                              | `claude-opus-5`                       | The hardest, highest-value output. $5/$25 per MTok, 1M context.                                                                                                         |
| Assessment generation                                  | `claude-opus-5`                       | Question quality is the whole feature; a weak question corrupts a skill score.                                                                                          |
| Answer grading (short answer, explain, teach-back)     | `claude-opus-5` at `effort: "medium"` | Grading is judgment; cheap grading produces wrong scores, which is worse than no scores.                                                                                |
| Study plan generation                                  | `claude-sonnet-5`                     | Structured planning over known inputs. $3/$15 — **note the $2/$10 introductory rate runs through 2026-08-31**, so early cost measurements will understate steady-state. |
| Resource metadata extraction (URL → title/author/type) | `claude-haiku-4-5`                    | High-volume, low-judgment. $1/$5.                                                                                                                                       |
| Friction → suggestion summarization                    | `claude-haiku-4-5`                    |                                                                                                                                                                         |
| Weekly narrative digest (v2)                           | `claude-opus-5` via **Batch API**     | Not latency-sensitive → 50% discount.                                                                                                                                   |

Defaults live in one config object, overridable per environment, so a model change is a deploy not a refactor.

### 8.2 Request conventions

- **Thinking is on by default on `claude-opus-5`** (omitting the field runs adaptive). Don't disable it — use `output_config: { effort }` to control depth. Note `max_tokens` caps thinking _plus_ response text, so size it with headroom.
- **`temperature`, `top_p`, `top_k` are rejected** on Opus 5 — steer with prompting.
- **Assistant prefills are rejected.** Use structured outputs.
- **Stream anything over ~16K `max_tokens`** and use `.finalMessage()`, or you'll hit SDK HTTP timeouts.
- **Set `effort` deliberately per call site.** `high` is the default; `low`/`medium` are unusually capable on Opus 5 and are the primary cost lever. Sweep them against real outputs rather than guessing.

### 8.3 Structured outputs

Every non-prose model call returns a validated object. One Zod schema per call site in `packages/llm/schemas`, reused by the API DTO so the model's output and the API contract can't drift.

```ts
// packages/llm/schemas/assessment.ts
export const AssessmentQuestion = z.object({
  format: z.enum(['mcq','short_answer','explain','applied','spot_the_bug','scenario']),
  prompt: z.string(),
  options: z.array(z.string()).length(4).optional(),
  correct: z.union([z.string(), z.array(z.string())]),
  rationale: z.string(),
  cites: z.array(z.object({ kind: z.enum(['lesson','reference','resource']), id: z.string() })),
});
export const GeneratedAssessment = z.object({ questions: z.array(AssessmentQuestion).min(5).max(20) });

// call site
const res = await client.messages.parse({
  model: 'claude-opus-5',
  max_tokens: 16000,
  output_config: { format: zodOutputFormat(GeneratedAssessment) },
  messages: [...],
});
res.parsed_output!.questions   // validated
```

**MCQ hygiene is enforced in code, not hoped for in the prompt** (FR-X6). A post-generation validator rejects any question whose options differ in length by more than ~15%, or where one option is conspicuously longer/more qualified than the rest. Rejected questions are regenerated once, then dropped. The `teach` skill is explicit about this and it's exactly the kind of rule a model will drift on.

### 8.4 Prompt caching

Caching is a **prefix match**: `tools` → `system` → `messages`, and any byte change invalidates everything after it. Minimum cacheable prefix on Opus 5 is 512 tokens. Reads cost ~0.1×; writes cost 1.25× (5-minute TTL).

Rules for `packages/llm`:

1. **The system prompt is frozen per purpose.** No timestamps, no user IDs, no session IDs, no conditional sections. Anything dynamic goes into `messages`, after the last cache breakpoint.
2. **Tool lists are sorted deterministically** and never vary within a purpose.
3. **Mission context is the cache boundary.** For repeated calls within one mission (assessment generation, grading a batch of answers), put the mission + learning-records + reference-doc block first with a `cache_control` breakpoint at its end, and the varying question after it.
4. **Assert on cache hits in dev.** If `usage.cache_read_input_tokens` is 0 across repeated calls with the same prefix, something is silently invalidating it — log a warning in non-production.

For grading a 15-question assessment, this is the difference between paying for the mission context 15 times and paying for it once.

### 8.5 Frictionless capture (FR-R2)

`POST /resources/capture { url }`:

1. Fetch the URL server-side (SSRF-guarded: no private IP ranges, redirect cap, 5s timeout, size cap).
2. Extract Open Graph / JSON-LD / `<title>` — pure parsing, no model call.
3. Only if extraction is weak, fall back to `claude-haiku-4-5` with a structured output for `{title, author, type, estimated_minutes}`.

Most captures cost nothing. That matters — this endpoint runs on every article you save.

### 8.6 Cost control

- Every call writes a `llm_calls` row with token counts (including cache reads/writes) and computed cost.
- Per-user monthly soft cap, configurable. On breach: non-essential jobs (digests, plan regeneration) pause; user-initiated jobs warn and continue.
- A cost meter in the UI. If you're spending $80/month on lesson generation you should find out from the app, not the invoice.
- Rough order of magnitude for one lesson generation with warm cache: tens of cents. Measure it in the first week rather than trusting that estimate — agent runs vary enormously with turn count.

---

## 9. Algorithms (`packages/core`)

Pure, deterministic, exhaustively unit-tested. These encode the product's opinions, so they're the highest-value tests in the repo.

### 9.1 Skill score, decay, and confidence

Score is a **time-weighted, evidence-weighted, decayed** aggregate:

```
weight(e)   = kindWeight(e.kind) × exp(-ln(2) × ageDays(e) / halfLife)
score       = Σ (e.raw_score × weight(e)) / Σ weight(e)
score_stddev= weighted stddev, floored to widen as evidence ages
```

- `kindWeight`: `artifact 1.0 > teach_back 0.9 > assessment 0.8 > review 0.6 > lesson 0.35 > self_report 0.1`. Shipping something beats answering questions about it (FR-W2).
- `halfLife` is per skill, defaulting to 90 days, adjusted by observed review performance: a skill you keep getting right after long gaps earns a longer half-life.
- **`score_stddev` widens with evidence age.** A skill last tested 6 months ago should read `61 ±24`, not `61`. This is what makes the dashboard honest (FR-S3, FR-S4).
- **Calibration gap** = `perceived_level − score`, plus a per-assessment version from confidence ratings (FR-S5). A persistently positive gap is overconfidence and is the single highest-value number the app produces.

### 9.2 Spaced repetition

**FSRS** (`ts-fsrs`), not a hand-rolled SM-2. Two adaptations:

- **Daily load cap** with overflow: items past the cap are pushed, prioritized by `(overdue days × skill importance)`. Anki's unbounded-backlog death spiral is itself wasteful friction (FR-V6).
- **Review outcomes are `skill_evidence`** with `kind='review'`, so retention directly feeds skill scores. That's the loop that makes a score mean something.

### 9.3 Friction classification

Deterministic mapping, no model call:

```
productive  = { productive_struggle }
            ∪ { too_hard | missing_prerequisite  where the session still
                produced a learning record or a passed review }
wasteful    = everything else
```

The conditional clause matters: "too hard" that you _pushed through_ is desirable difficulty; "too hard" that ended the session is a ZPD miss. Same event type, opposite meaning, distinguished by outcome.

**Suggestions** (FR-C4) are rule-based first — thresholds over recent windows (`tooling > 30% of sessions on mission X over 14 days` → "spend a session fixing your environment"). Only the _phrasing_ goes near a model, and only in v2. A rule you can read beats an LLM opinion you can't audit.

### 9.4 ZPD recommendation

Candidate scoring over the skill graph:

```
score(skill) = readiness × missionRelevance × (1 − recentCoverage) × decayUrgency
readiness    = fraction of prerequisites at ≥ 'working' band
decayUrgency = 1 − exp(-ln(2) × daysSinceEvidence / halfLife)
```

Top candidates go into `BRIEFING.md` (§7.3) and onto the home screen. The recommender **proposes**; the teach agent decides. Don't try to out-think the skill's own ZPD logic — feed it state it can't otherwise see.

---

## 10. Background jobs

| Queue / job                         | Trigger                        | Notes                                                                           |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `teach:generate-lesson`             | User action                    | Agent SDK. One per mission concurrently. 15-min timeout.                        |
| `teach:sync-workspace`              | Manual, or after any agent run | Diff + reindex.                                                                 |
| `assessment:generate`               | User action                    | Structured output + MCQ validator.                                              |
| `assessment:grade`                  | On submit                      | Batched per assessment for cache reuse.                                         |
| `scores:recompute`                  | Nightly + on new evidence      | Decay means scores change with no user action.                                  |
| `review:build-queue`                | Nightly per user timezone      | Materializes tomorrow's queue and load-caps it.                                 |
| `insights:rollup`                   | Nightly                        | Pre-aggregates focus/friction into daily rollup tables so dashboards stay fast. |
| `notify:decay-warning`              | Nightly                        | "You're about to lose Rust lifetimes."                                          |
| `notify:stall-detection`            | Daily                          | Missions untouched >N days.                                                     |
| `account:export` / `account:delete` | User action                    |                                                                                 |
| `digest:weekly`                     | Weekly, Batch API              | v2.                                                                             |

Nightly jobs run **per user timezone**, not at a global UTC hour. A "daily review queue" that rolls over at 4pm local is a bug.

---

## 11. Security & privacy

This data is a detailed map of your weaknesses. Treat it accordingly.

- **RLS on every table**; worker code filters `user_id` explicitly and is reviewed for it (§3.6).
- **Lesson HTML is untrusted** — separate origin, sandboxed iframe without `allow-same-origin`, restrictive CSP, `connect-src 'none'` (§7.5).
- **SSRF guard** on `POST /resources/capture` and anywhere else a user-supplied URL is fetched: block private/link-local/metadata IP ranges, cap redirects, cap response size, short timeout.
- **Secrets** live in Railway/Supabase env config. The Anthropic key exists only in `worker` and `api`, never in the SPA bundle.
- **What goes to Anthropic, and when** is documented in-app and logged. A user should be able to answer "did my friction notes get sent to a model?" from the UI. (Answer: only if they trigger a job that needs them.)
- **Rate limits** per user on LLM-triggering endpoints, independent of the cost cap.
- **PII in prompts:** notes and reflections can be deeply personal. Send only what a job needs — grading an answer doesn't need your friction log.

---

## 12. Observability

- **Structured logs** (Pino) with `requestId`, `userId`, `agentRunId` on every line.
- **Sentry** for both `api` and `worker`; agent-run failures are first-class errors, not swallowed job retries.
- **`llm_calls`** is the cost source of truth. A weekly internal query answers: cost per lesson, cache hit rate, cost per skill point gained.
- **Agent run traces** stored as JSON (turn count, tools used, files touched, tokens) — when a lesson comes out bad you need to see what the agent actually did.
- **Health checks** on both services; Railway restarts on failure. The worker drains in-flight jobs on SIGTERM before exiting.

---

## 13. Testing

**Everything ships with automated tests at all three levels — unit, integration, and end to end. The global coverage floor is 80%, enforced in CI; a build below it fails and does not merge or deploy.**

### 13.1 Coverage policy

80% global, with **per-area thresholds** so the number means something. A flat 80% lets you hit the target by testing DTOs while leaving the scoring math bare — which is exactly backwards, because that's where a silent bug produces confidently wrong numbers rather than a crash.

| Area                                   | Lines    | Branches | Why                                                                                                                                  |
| -------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`                        | **100%** | **95%**  | Scoring, decay, calibration, FSRS, friction classification. A wrong number here is invisible and corrupts every downstream decision. |
| `apps/api` — `domain/`                 | 95%      | 90%      | Entity invariants are the rules of the product.                                                                                      |
| `apps/api` — `application/`            | 90%      | 85%      | Use cases: every command and query has at least a success and a failure test.                                                        |
| `apps/api` — `infrastructure/`         | 80%      | 70%      | Repository impls and mappers, covered via integration tests against real Postgres.                                                   |
| `packages/llm`                         | 85%      | 75%      | Schema validation, MCQ hygiene, cache-breakpoint construction.                                                                       |
| `apps/web` — `features/*/api`, `model` | 85%      | 75%      | Query keys, optimistic rollback, derived selectors.                                                                                  |
| `apps/web` — `shared/ui`               | 80%      | 70%      | The temper gauge gets its own suite — feathering is load-bearing, not decoration.                                                    |
| **Global floor**                       | **80%**  | **75%**  | Fails the build below this.                                                                                                          |

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

| Target          | Tool                          | Notes                                                                                                                                                                                                      |
| --------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Vitest + fast-check           | **Property-based** for decay and scoring: a score never exceeds its bounds; decay is monotonic without new evidence; adding evidence never widens the confidence interval. Example-based tests miss these. |
| Domain entities | Vitest                        | Every invariant gets a test that proves it _rejects_ the invalid case, not just accepts the valid one.                                                                                                     |
| Use cases       | Vitest + in-memory repo fakes | The repository interface makes fakes trivial. Test the rule, not the SQL.                                                                                                                                  |
| Parsers         | Vitest + fixtures             | Real `teach` output, plus deliberately malformed files proving degradation is graceful.                                                                                                                    |
| LLM layer       | Vitest + recorded fixtures    | **Never hits the live API in CI.** Schema validation, MCQ hygiene validator, cache-breakpoint construction.                                                                                                |

**Integration** — real Postgres, real Storage, real Redis; no mocks at the boundary.

| Target         | Tool                             | Notes                                                                                                                                                           |
| -------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositories   | Vitest + Testcontainers Postgres | Migrations applied per suite. Mappers verified round-trip.                                                                                                      |
| **RLS**        | Vitest + Testcontainers          | **Mandatory and non-negotiable: for every table, prove user A cannot read or write user B's rows.** A new table without an RLS test is an incomplete migration. |
| API routes     | Vitest + Nest testing module     | Real DI graph, real DB, HTTP in and out. Auth guard included — an unauthenticated request must 401.                                                             |
| Workspace sync | Vitest + Storage emulator        | Added / modified / deleted / **conflict** — the conflict path especially, since it's the one that can lose work.                                                |
| Queue          | Vitest + Redis container         | Job enqueue → consume → result, including retry and timeout.                                                                                                    |

**End to end** — Playwright, real browser, real stack.

| Flow                                                                             | Why it's covered                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Sign up → sign in → sign out                                                     | Auth is the front door.                                         |
| The capture loop: start focus → log friction → stop → debrief → appears on today | The core daily habit; if this breaks, the product is dead.      |
| Add a resource by URL → update progress → abandon with reason                    | The second most-used path.                                      |
| Weekly plan → log sessions → weekly review shows plan vs. actual                 | The retention ritual.                                           |
| Generate a lesson → run completes → lesson renders in the sandbox → mark outcome | The agent path, with the model stubbed.                         |
| Review queue: due items → answer → schedule moves                                | Retention loop.                                                 |
| Offline: go offline → log friction → reconnect → event persists exactly once     | Idempotency, which is easy to get wrong and silent when you do. |
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

| Env     | Supabase                           | Railway                                              |
| ------- | ---------------------------------- | ---------------------------------------------------- |
| local   | Supabase CLI (Docker)              | `pnpm dev` — api, worker, web, lessons + local Redis |
| preview | Shared staging project             | Railway PR environments                              |
| prod    | Dedicated project, PITR backups on | `api`, `worker`, `lessons`, Redis                    |

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

- **`pnpm seed:minimal`** — one user, one mission, three skills with prereq edges, two resources. Enough to click through. Used by E2E.
- **`pnpm seed:rich`** — 6 months of synthetic history: ~200 focus sessions with realistic weekday/weekend distribution, friction events weighted toward tooling and interruption, review logs producing a believable retention curve, and skills at varied evidence ages so the **gauges actually feather differently**.

The rich set exists because insights, the activity grid, decay curves, and the galaxy are all unbuildable against an empty database — you cannot design a retention chart with three data points. Generate it from a fixed seed so it's reproducible, and keep it out of production by construction (guard on `NODE_ENV`).

- **Migrations** are `prisma migrate` files in `packages/db/prisma/migrations`, applied with `prisma migrate deploy` in a release command before the new revision takes traffic. **RLS policies and any `check` constraints Prisma can't express go in hand-edited SQL inside those migration files** — never clicked into the Supabase dashboard, which is how environments drift. Generate with `prisma migrate dev --create-only`, then add the policy SQL before applying.
- **Connection pooling:** point Prisma at Supabase's pooler (`DATABASE_URL`, pgbouncer, `?pgbouncer=true&connection_limit=1`) and at the direct connection for migrations (`DIRECT_URL`). Getting this wrong surfaces as prepared-statement errors under load, not at deploy time.
- **Workspace Storage bucket is private.** All access goes through signed URLs minted after an ownership check.
- **Backups:** Postgres PITR via Supabase; Storage bucket versioning on. A lost lesson is unrecoverable creative work.

---

## 14.1 Versioning and changelog

**One version for the whole product**, not per-package. It's a single deployable product with a single user; independent package versions would be bookkeeping with no reader.

- **SemVer** in the root `package.json`, the single source of truth.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, scoped: `feat(friction): …`), already the commit convention in `CLAUDE.md` where requirement IDs are also referenced.
- **`release-please`** on GitHub Actions derives the version bump, writes `CHANGELOG.md`, tags, and opens the release PR. Nothing is versioned by hand.
- **Build metadata** — git SHA, build timestamp, and the applied migration name — is injected at build time and exposed at `GET /v1/health`. When something is wrong in production, "which code and which schema is actually running" is the first question, and it should take one request to answer.
- **Sentry releases** are tagged with the same version so a stack trace maps to a commit.

### In-app changelog

`CHANGELOG.md` is the source; the app renders it. Two surfaces:

- **Settings → What's new** — the full history, searchable.
- **An unobtrusive marker** when there are entries newer than your last-seen version. A single dot on the settings entry, dismissed by opening it. **Not a modal, not a takeover** — an app that interrupts your focus session to announce itself has failed its own thesis.

Entries are written for a reader, not derived raw from commit subjects: `release-please` produces the skeleton and the release PR is where you rewrite it into plain sentences. A changelog nobody can read is a git log with extra steps.

### The self-referential bit

You are both the developer and the only user, which makes the changelog more useful here than in most products: **shipping a Mindforge feature is real-world evidence of skill.** A release can offer to log an **Artifact** (§3.4, FR-W1) against whatever skills the work exercised — the highest-weight evidence type there is, captured at the one moment you actually remember the details.

Opt-in per release, one tap, never automatic. It closes a loop the product otherwise leaves open: the thing you build to track your learning becomes something your learning is measured by.

---

## 15. Build phases

Each phase leaves a working, useful app.

### Phase 0 — Skeleton (est. small)

Monorepo, Prisma schema for §3.1/§3.3, RLS + RLS tests, Supabase Auth + Nest guard, SPA shell with routing and the command palette, Railway deploy for `api`/`web`.

### Phase 1 — The capture loop (the v0 milestone)

Missions · Goals · Skills (manual score only) · Resources with progress and capture-by-URL · Focus timer with intention + debrief · Friction logging · Weekly plan vs. actual · One dashboard · Offline queue · PWA.
**No LLM calls at all.** Ship it, use it for three weeks, and see whether the data is there. If it isn't, no amount of AI fixes the app.

### Phase 2 — The teach engine

Storage workspaces · Agent SDK worker · sync + reindex + conflict UI · lesson/reference library with the sandboxed renderer · learning records · per-user learner memory + its review screen (§7.6) · `BRIEFING.md` / ZPD recommender · `agent_runs` + SSE progress · `llm_calls` cost tracking.
This is the phase where the risky unknowns live — budget accordingly.

### Phase 3 — Retention and measurement

Review queue (FSRS) · assessments with confidence rating · grading · evidence-based skill scores with decay and confidence intervals · calibration gap · study plans · the insights suite · weekly review ritual.

### Phase 4 — Reduce the friction it measures

Readwise/Kindle · calendar · podcast history · GitHub artifacts · browser extension · AI weekly digest · teach-back grading · `mindforge` CLI for local `/teach` round-tripping.

---

## 16. Open technical items

1. **Agent SDK API verification** — §7.3 is a design sketch. Read `code.claude.com/docs/en/agent-sdk` before Phase 2 and correct the processor accordingly. _(Blocking for Phase 2, nothing earlier.)_
2. **Agent run cost and latency** — unknown until measured. A lesson may take 3 minutes or 12; it may cost $0.20 or $2. Measure in the first week of Phase 2 and revisit model/effort settings.
3. **Managed Agents re-evaluation** — if the memory-store model stabilizes out of beta, it deletes §7.4 entirely. Worth a spike at Phase 4.
4. **Lesson asset handling** — the `teach` skill wants a shared `assets/` component library per workspace. Confirm relative-path resolution works through the signed-URL lessons origin; may need path rewriting on serve.
5. **FSRS parameter fitting** — default parameters until there's enough `review_logs` to fit personalized ones (needs ~1000 reviews). Plan the refit job, don't build it yet.
6. **Timezone handling** — store the user's IANA timezone on the profile; every "day", "week", and nightly job derives from it. Get this right at Phase 1 or every analytics number will be subtly wrong.
7. **Mission slug immutability** — `workspace_key` is a Storage prefix, so renaming a mission must not move files. Slug is set once at creation; the display topic is free to change.
