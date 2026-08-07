# Mindforge — North Star & Roadmap

**Status:** Draft v0.1
**Date:** 2026-08-05
**Companions:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) (what to build) · [`TECH-DESIGN.md`](./TECH-DESIGN.md) (how to build it)

This document is the destination and the staircase. It answers two questions: _what does "done" look like_, and _what is the next thing I build_.

---

## 1. The north star

> **Mindforge is the one place that tells you the truth about your learning.**

Not how much you consumed. Whether it worked.

### A Tuesday, once it exists

You open Mindforge at 8:40am. It doesn't greet you. It says: **three reviews due, 12 minutes**, and below that, one line — _your ownership model held; lifetimes didn't._ You do the reviews. Two land, one doesn't; the one that doesn't schedules itself closer.

You hit **Start focus**. One field: what does done look like? You type _"get the parser handling nested groups."_ The timer runs. Forty minutes in, a build tool breaks. You tap once — **tooling** — and keep going. At the end: did you hit it? _Partly._ Focus quality 4. Energy 3.

At 4pm you open a lesson the agent generated overnight from your mission, your last three learning records, and the two skills the graph says you're now ready for. It takes eight minutes. It's hard in the right way. You finish it and mark it _shaky_, which is honest, and the app believes you.

### A Sunday, once it exists

The weekly review takes six minutes. It shows you planned 5 hours on Rust and spent 6:20 — but 59% of that was **slag**, and most of it was tooling on the same project. The suggestion is not motivational: _"Tooling friction is 40% of your Rust sessions over the last 14 days. Spend one session fixing your environment."_

It shows your Postgres skill has faded to `37 ±22`, edges dissolved, because you last proved anything in January.

It shows your calibration gap is **+18** — you consistently rate yourself higher than you test. That number has been getting smaller for two months, and that's the single best thing on the screen.

### The map

Everything you know about a domain is one **galaxy**. Foundations sit at the core; specializations radiate outward as arms; each star is a skill, positioned by how many prerequisites deep it is. Arms are allowed to touch — the bridges between them (async ↔ web, types ↔ performance) are often where the valuable knowledge is.

The galaxy isn't decoration, because every visual property carries a value the app already computes:

| You see               | It means                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Brightness**        | Skill score. Dim stars are unproven, not unknown.                                                                   |
| **Haze**              | Uncertainty — the same feathering language as the temper gauge. A skill untested for months goes soft at the edges. |
| **Dimming over time** | Decay. Light fading is what decay actually feels like.                                                              |
| **Dark regions**      | Your frontier. The zone of proximal development is the ring just past where the light stops.                        |

Nobody places stars by hand. The teach agent proposes structure as it teaches; position is computed from the prerequisite graph. And the galaxy is the **navigation** view, not the analysis view — radial layouts are superb for "where am I, where next" and poor for comparing two numbers, so gauges and lists stay for that.

### What makes it work

- **Evidence, not vibes.** Every score traces to something you did.
- **Decay is visible.** Skill fades on screen the way it fades in your head.
- **Friction is split.** The hard part that teaches you is counted separately from the hard part that wastes you.
- **It never flatters you.** When the week was bad, it says so, plainly, once.

---

## 2. How we'll know we got there

In priority order (detail in `REQUIREMENTS.md` §8):

1. **Still in use after 90 days.** Everything else is moot.
2. Retention lift on active skills.
3. Ember share up, slag share down.
4. Plans get more honest (adherence up, _or_ plans get smaller — both are wins).
5. Artifacts shipped per quarter.
6. Calibration gap shrinking.

---

## 3. Principles that govern every step

These don't change between milestones. When a decision is close, these break the tie.

| Principle                                 | Consequence                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Capture in ≤5s, ≤2 taps**               | If a feature can't meet this, automate it or cut it. Non-negotiable.                                                                                                     |
| **Mobile-first for capture and review**   | Friction logging, the timer, and the review queue are phone interactions before they are desktop ones. Analysis and authoring stay desktop-first. `TECH-DESIGN.md` §5.1. |
| **Honesty over encouragement**            | No fake celebration, no inflated scores, no hidden decay.                                                                                                                |
| **Evidence over self-report**             | Scores are derived. Self-ratings are stored separately and compared, never trusted.                                                                                      |
| **Files stay canonical**                  | The teach workspace must always be usable from a terminal without Mindforge.                                                                                             |
| **Every insight names an action**         | An insight that doesn't change what you do next gets cut.                                                                                                                |
| **Boring where it's not the point**       | Spend novelty on the temper gauge and the friction split. Everything else is quiet.                                                                                      |
| **Ship a usable thing each milestone**    | If you stop after any step, what's there still earns its keep.                                                                                                           |
| **Tested at all three levels, 80% floor** | Unit, integration, and E2E ship _with_ the feature, not after. CI fails below 80%. `packages/core` is held to 100% — see `TECH-DESIGN.md` §13.                           |

---

## 4. The staircase

Ten steps. Each is a week or three of evenings, ships something usable, and has an observable finish line.

---

### M0 — Foundations

**Goal:** a deployed skeleton you can log into.

- Monorepo (`apps/web|api|worker|lessons`, `packages/core|db|llm`) — **pnpm + Turborepo**, Node 22, shared tsconfig, Vitest + Playwright wired
- **GitHub Actions** with the §13.3 gates; Turbo remote cache
- `design/tokens.css` moved into `apps/web/src/styles/` — the visual language lands before the first component
- Seed scripts: `seed:minimal` and `seed:rich` (6 months of synthetic history, so insights are designable)
- Prisma schema for missions, goals, skills, resources, tasks, focus sessions, friction events
- RLS policies in migrations **plus the RLS test suite** — user A cannot read or write user B's rows
- Supabase Auth: email+password and GitHub; `SupabaseAuthGuard` on the Nest side
- Design tokens from the identity spec as CSS custom properties; light default, dark via toggle
- **i18n scaffolding (en + pt-BR)** — react-i18next, ICU, the domain glossary, and the missing-key CI check. Set up now; retrofitting means touching every component ever written (FR-L1..L7)
- Railway: `api` + `web` deployed, Supabase project provisioned, migrations run on release
- **Versioning + changelog**: Conventional Commits, `release-please`, build metadata on `/v1/health` (`TECH-DESIGN.md` §14.1)

**Done when:** you sign in on the deployed URL and see an empty state that isn't a 500.

---

### M1 — The capture loop

**Goal:** the daily habit, with zero AI.

- Missions (create, edit, park — with the WIP limit of 3) and Goals
- Skills: create, prerequisite edges, **manual** self-rating only
- Resources: add, type-specific progress, status transitions, guilt-free abandon with reason
- URL capture → server-side metadata extraction (no model call)
- **Focus timer:** start with an intention → run → stop → ≤30s debrief
- **Friction logging:** one tap, typed, mid-session, no modal
- Manual and retroactive session entry (you _will_ forget the timer)
- **Notes on anything** — one tap from a running session, or from any resource, skill, or mission (FR-N1..N3)
- Command palette (⌘K) for start-focus, log-friction, add-resource
- Offline queue in IndexedDB with client-generated UUIDs
- **Today screen** per `TECH-DESIGN.md` §5.3 — running session, due now, next, this week, one thing
- **Guided first mission** — four steps producing a real mission, goal, resource, and focus session (not a demo, not a questionnaire)

**Done when:** you've logged 10 real focus sessions without opening the code.

> **Stop here for three weeks and actually use it.** This is the milestone that decides whether the product is real. If capture doesn't stick, no amount of AI downstream fixes it — and it's much cheaper to learn that now.

---

### M2 — The weekly rhythm

**Goal:** the habit loop that stops it being abandoned at week three.

- Weekly planning grid: target minutes per mission/skill
- Plan vs. actual view
- **Weekly review screen:** what moved, what stalled, top friction sources, next week's allocation
- Ember/slag ratio, computed by the deterministic rule (not a model)
- Backlog health: queue growth vs. throughput, stalled items, abandonment reasons
- **Activity grid**: intensity = minutes, hue = ember share; layers for reviews, lessons, notes; consistency over streaks (FR-I6b)
- Nightly rollup job into `daily_activity`, per user timezone
- Notifications: weekly review time, stall detection — quiet by default
- **In-app changelog** (Settings → What's new) with an unseen-entries marker
- Two carryovers M2 cannot be built honestly without: **`seed:minimal` / `seed:rich`** (an M0 bullet — the grid and the insights are undesignable against an empty database) and **a settings write path**, since `profiles` was read-only over the API and "per user timezone" described a column nobody could set

**Done when:** you've done three weekly reviews and changed one thing because of one.

> **Deferred out of M2:** the optional one-tap **Artifact** logging per release (`TECH-DESIGN.md`
> §14.1). It needs the `artifacts` table, which is the wisdom pillar and belongs with the rest of
> M6 — shipping an artifacts surface with one caller, ahead of its milestone, to serve a changelog
> bullet is backwards. The changelog itself ships.

---

### M3 — The workspace and the agent

**Goal:** `teach` runs in the cloud. The riskiest milestone — timebox the spike.

- **Day one: read the Agent SDK docs** and correct `TECH-DESIGN.md` §7.3 against the real API
- Supabase Storage workspace per mission, layout identical to a local teaching workspace
- Worker: materialize → run → sync → reindex → delete, with hard timeout and turn cap
- `workspace_files` hash ledger; ETag-based conflict detection with a resolution UI
- Defensive parsers for `MISSION.md`, `RESOURCES.md`, `learning-records/`, returning warnings not failures
- `BRIEFING.md` generation (ZPD candidates, weak skills, due reviews)
- `agent_runs` + SSE progress; `llm_calls` cost tracking from the first call
- Per-user learner memory (`memory/<user_id>/`) with its review screen

**Done when:** you press "Teach me the next thing", wait, and a lesson file exists in Storage and a row exists in Postgres — and running `/teach` locally against the same workspace still works.

---

### M4 — Lessons in the product

**Goal:** the generated material is usable, not just stored.

- Sandboxed lesson renderer: separate origin, `sandbox="allow-scripts"` without `allow-same-origin`, strict CSP
- Lesson library, reference-doc library (searchable — these are the ones you revisit)
- Learning records: browse, create, link, supersede
- Lesson completion + outcome (understood / shaky / lost) → first automatic skill evidence
- `postMessage` bridge for in-lesson quiz results

**Done when:** you complete three generated lessons end to end and the reference docs are somewhere you'd actually look things up.

---

### M5 — Retention

**Goal:** make the learning stick, and make scores mean something.

- FSRS via `ts-fsrs` in `packages/core`, fully unit-tested
- Daily review queue with a load cap and overflow handling
- Item creation: from lesson quizzes, **any note promoted in one tap**, learning-record insights, manual
- Full-text search across notes (FR-N6)
- Item types beyond flashcards: recall prompts, explain-it
- Review results become `skill_evidence`
- Decay warnings ("10 minutes of review saves this")

**Done when:** you've held a review streak of two weeks and a skill score has visibly moved because of reviews alone.

---

### M6 — Measurement

**Goal:** the numbers become honest.

- AI assessment generation, grounded in your own lessons, records, and resources
- **Confidence rating before reveal** → calibration gap
- MCQ hygiene validator (equal-length options), enforced in code
- Grading: auto for MCQ, model-graded for short answer and explain
- Flag-a-bad-question, excluded from scoring
- Evidence-weighted skill score with decay and confidence interval → **the temper gauge goes live**
- Baseline + periodic re-test per skill
- Artifacts: log real-world evidence, weighted highest

**Done when:** every skill on your dashboard shows a score you'd defend, with edges that feather correctly.

---

### M7 — The galaxy

**Goal:** you can see the whole shape of what you know, and where the edge is.

Deliberately after M6: a galaxy drawn from self-reported scores would be a pretty lie. It only becomes honest once brightness is backed by evidence.

- **Schema delta:** `domains` (a galaxy) and `tracks` (an arm); skills gain `domain_id` and an optional `track_id`. Core-ness is _derived_ — a skill with no prerequisites inside its domain is core, and radial distance is prerequisite depth. Nothing is hand-positioned. (Needs a corresponding update to `TECH-DESIGN.md` §3 when this milestone starts.)
- Layout computed from `skill_edges`; cross-arm bridges rendered faint rather than forbidden
- Visual encoding: brightness = score, haze = confidence interval, dimming = decay, dark = frontier — reusing the temper palette and the gauge's feathering, not inventing a second visual language
- Zoom levels: domain → track → skill, so a 200-skill galaxy stays readable
- The teach agent proposes domain and track assignment for new skills; you can correct it, and corrections stick
- Click a star → its evidence, its lessons, its due reviews
- **"Show me the frontier"** — the reachable-but-unlit ring, which is the ZPD recommender rendered as a place rather than a list

**Done when:** you look at a galaxy and decide what to learn next from it, without opening a list.

---

### M8 — Insights

**Goal:** the app tells you something you didn't know.

- Focus analytics: by mission/skill/week, best time-of-day, best-conditions
- Friction analytics: ember/slag trend, top sources, rule-based recommendations
- Learning analytics: retention curves, review accuracy, calibration per skill, ZPD hit-rate
- **Consumption vs. retention** — the signature chart
- Goal projections from real pace, stated bluntly
- Study plans: build, AI-assist, adapt honestly when you fall behind

**Done when:** an insight causes you to drop or restructure a mission.

---

### M9 — Reduce the friction it measures

**Goal:** close the loop — the app stops being a source of the thing it tracks.

- Readwise / Kindle highlights
- Calendar: push planned focus blocks, pull meetings so plans are realistic
- Podcast and video history
- GitHub → suggested artifacts from merged PRs
- Browser extension / share-target capture
- AI weekly narrative digest (Batch API)
- Teach-back grading
- `mindforge` CLI for local `/teach` round-tripping

**Done when:** most resources arrive without you typing anything.

---

## 5. Not building (and when that changes)

| Not now                                       | Revisit when                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Multi-user, sharing, social                   | Never, unless the single-user version has been in daily use for a year |
| Native mobile apps                            | PWA proves insufficient in real use                                    |
| Managed Agents instead of the Agent SDK       | It leaves beta — it would delete the whole sync subsystem              |
| Automatic time capture (IDE/browser activity) | M9, opt-in and local-first only                                        |
| Personalized FSRS parameters                  | ~1000 reviews logged                                                   |
| Gamification of any kind                      | Never. It corrupts the data the product exists to collect.             |

---

## 6. Sequencing rules

1. **Never skip M1's three-week soak.** The temptation to jump to the agent is enormous and it is the single most likely way this project dies half-built.
2. **M3 is the spike.** Timebox the Agent SDK integration. If it fights back for more than a week, fall back to the raw Messages API path in `TECH-DESIGN.md` §7.1 rather than stalling.
3. **Cost tracking ships with the first LLM call**, not after. A cost surprise in month two is avoidable.
4. **`packages/core` gets tests before it gets callers.** Scoring, decay, and FSRS are where a silent bug produces confidently wrong numbers — the worst failure this product can have.
5. **Each milestone ends with you using it**, not with the tests passing.

---

## 7. Open questions to answer along the way

- **M3:** what does an agent run actually cost and how long does it take? Everything about the LLM budget depends on it.
- **M5:** does the review queue survive contact with a busy week, or does it become the backlog it was meant to prevent?
- **M6:** do generated assessments hold up, or does the flag rate make scores untrustworthy?
- **M7:** which insights actually change behavior? Cut the rest — that's the discipline that keeps this from becoming a dashboard graveyard.
