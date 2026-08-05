# CLAUDE.md

Mindforge — a personal system for tracking learning, attention, and cognitive friction.

## Read first

| Doc | For |
| --- | --- |
| [`NORTHSTAR.md`](./NORTHSTAR.md) | The destination, the principles, and which milestone we're on |
| [`REQUIREMENTS.md`](./REQUIREMENTS.md) | What to build. Requirements are referenced by ID (FR-S3, FR-C1…) — use those IDs in commits and PRs |
| [`TECH-DESIGN.md`](./TECH-DESIGN.md) | How to build it: architecture, schema, algorithms, testing |

Don't restate these docs here. When something changes, update the doc, not this file.

## Status

**Pre-M0** — no code yet. Commands and file-path conventions get filled in once the monorepo exists.

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
- Don't port the backend's four layers into React. Query *is* the data layer.

## Testing

Unit + integration + E2E, **80% global floor enforced in CI**, `packages/core` at 100%. Full policy in `TECH-DESIGN.md` §13.

- A bug fix starts with a failing test.
- Test the agent on shape (files created, records parse), never on generated content.
- Flaky tests are bugs: quarantine in a day, fix in a week.

## Conventions

- **TypeScript strict**, no `any` without a comment explaining why.
- **Zod schemas live in `packages/core`** and are shared by API validation, SPA forms, and LLM structured outputs. One definition, three consumers.
- **Timestamps are `timestamptz`.** Every "day", "week", and scheduled job derives from the user's IANA timezone, never server-local.
- **No hardcoded user-facing strings.** en + pt-BR, `react-i18next` with ICU. Enum values are keys; the UI translates at render. Format dates, numbers, and durations with `Intl` or a `packages/core` helper — never by hand. UI locale, timezone, and *content language* (what the agent writes lessons in) are three separate settings. (`TECH-DESIGN.md` §5.2)
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
