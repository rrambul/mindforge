# Mindforge — North Star & Roadmap

**Status:** v0.2 — refocused on the curriculum flow
**Date:** 2026-08-10
**Companions:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) (what to build) · [`TECH-DESIGN.md`](./TECH-DESIGN.md) (how to build it)

This document is the destination and the staircase. It answers two questions: _what does "done" look like_, and _what is the next thing I build_.

> **v0.2 refocus.** The v0.1 plan grew nine feature pillars — goals, skill scoring, friction
> analytics, spaced repetition, assessments, a skill galaxy, insights, integrations — around a core
> that was never finished. All of that is cut. What remains is one flow, built end to end:
> **curriculum → modules → lessons → progress · time · frequency.** Everything cut is listed in §5,
> with the condition under which it returns. Nothing was lost: the cut code is one git revert away,
> and the cut ideas live in this file's history.

---

## 1. The north star

> **Mindforge turns a topic into a curriculum, teaches it lesson by lesson, and tells you the truth about how you're moving through it.**

One flow, no sidequests:

1. **Curriculum** — you give it a mission (the topic and the why). An agent, built on the `teach`
   skill, proposes a curriculum: an ordered set of **modules**, fundamentals first.
2. **Modules** — each module is a subtopic with a one-line outcome and a **planned lesson list**:
   every lesson named up front with a difficulty level, a depth level, and its dependencies on
   other lessons.
3. **Lessons** — generated one at a time, on demand, by the teach agent. You finish one, you ask
   for the next; the app knows which lessons are unblocked because the dependency graph says so.
4. **Progress tracker** — which lessons are done (and how they landed: understood / shaky / lost),
   how far each module is, honestly: completed over planned, with the plan visible and revisable.
5. **Time tracker** — the focus timer. Start with an intention, work, stop, ≤30s debrief. Sessions
   bind to the curriculum you were working through.
6. **Frequency tracker** — the activity grid. Which days you showed up, for how many minutes, and
   active days in the last 28. Consistency, not streaks.

### A Tuesday, once it exists

You open Mindforge. The Rust curriculum shows module 3 of 9 — _Ownership in practice_ — at 4 of 6
lessons, and one line: **next unblocked lesson: “Borrow checker errors as a debugging tool”,
difficulty 4, deep dive — depends on the two lessons you marked understood last week.** You hit
**Start focus**, type what done looks like, and do the lesson. At the end you mark it _shaky_ —
which is honest, and the app believes you — and the debrief takes twenty seconds. The grid gets one
more lit day.

### What makes it work

- **The curriculum is a plan, not a cage.** Lessons are planned up front — that is what makes
  progress a real fraction — but generated lazily, and the plan is revisable when the material
  teaches the agent something about you.
- **Dependencies are honest structure.** A lesson that depends on another is locked until its
  prerequisites are done; a lesson many others depend on is visibly **fundamental**. Both read
  straight off the same edge.
- **It never flatters you.** No fake celebration, no streak guilt, no inflated numbers. A _shaky_
  outcome stays shaky on the module until you redo the lesson.
- **Files stay canonical.** The teach workspace works from a terminal without Mindforge; Postgres
  is a rebuildable index over it.

---

## 2. How we'll know we got there

In priority order:

1. **Still in use after 90 days.** Everything else is moot.
2. **A full module completed end to end** — planned by the agent, taught lesson by lesson, every
   completion honest.
3. **The trackers answer their questions at a glance:** how far am I (progress), how much did it
   take (time), am I showing up (frequency).

---

## 3. Principles that govern every step

| Principle                                 | Consequence                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **One flow**                              | A feature that is not curriculum → modules → lessons → progress/time/frequency does not ship. §5 is the only other list.                               |
| **Capture in ≤5s, ≤2 taps**               | The timer and the lesson debrief are the only capture paths left; they stay under budget or they're wrong.                                             |
| **Mobile-first for capture**              | The timer and the debrief are phone interactions first. Reading lessons and browsing the curriculum are desktop-first.                                 |
| **Honesty over encouragement**            | No fake celebration, no inflated progress, no hidden nothing-happened weeks.                                                                           |
| **Derived numbers, computed on read**     | Module progress, unblocked lessons, fundamental badges, active days — all derived. A stored copy is a value that was true once.                        |
| **Files stay canonical**                  | The teach workspace must always be usable from a terminal without Mindforge. `CURRICULUM.md` is the curriculum; the DB indexes it.                     |
| **Lessons come from the teach skill**     | Lesson generation is a Mindforge agent skill built on the upstream `teach` skill (Matt Pocock's). Mindforge orchestrates it; it never reimplements it. |
| **Boring where it's not the point**       | Spend novelty on the curriculum view and the lesson reader. Everything else is quiet.                                                                  |
| **Ship a usable thing each milestone**    | If you stop after any step, what's there still earns its keep.                                                                                         |
| **Tested at all three levels, 80% floor** | Unit, integration, and E2E ship _with_ the feature. CI fails below 80%. `packages/core` is held to 100% — see `TECH-DESIGN.md` §13.                    |

---

## 4. The staircase

### Built (M0–M3, kept)

- **M0 — Foundations.** Monorepo, CI gates, Prisma + RLS (tested), Supabase auth, i18n (en +
  pt-BR), design tokens, versioning + changelog.
- **M1 — Capture.** Missions, the focus timer (intention → run → ≤30s debrief), manual and
  retroactive entry, offline queue, command palette, Today screen, guided first mission.
  _(Goals, skills, resources, notes and friction logging shipped here too — cut in v0.2.)_
- **M2 — Rhythm.** The nightly rollup into `daily_activity` and the activity grid.
  _(Weekly planning, weekly reviews, backlog health, stall nudges — cut in v0.2.)_
- **M3 — The agent.** The full teach pipeline: press "Teach me the next thing" → workspace
  materialises from Storage → briefing renders from what Mindforge knows → the agent runs with the
  teach skill loaded → files sync back with conflict retention → lessons, reference docs and
  learning records index into Postgres → `llm_calls` reconciles to the run's real bill. Per-user
  learner memory, reviewable in Settings. A real run: 26 turns, 8 minutes, $1.47.

### M4 — The curriculum

**Goal:** a mission gets a real curriculum: modules, and every module's lessons planned up front.

The in-flight curriculum work lands here, reshaped: `CURRICULUM.md` stays canonical and the
`curriculum` skill writes it — but it now plans **lessons, not skills**.

- `CURRICULUM.md` format: 8–15 modules (tracks), each with a one-line outcome, module
  prerequisites, and a **planned lesson list** — slug, title, one-line intent, **difficulty
  (1–5)**, **depth (overview / working / deep-dive)**, and **depends-on** edges naming other
  planned lessons (same module or earlier ones)
- `curriculum` skill: proposes the structure grounded in the mission and `RESOURCES.md` (a
  workspace file the agent maintains for grounding — not indexed into the app)
- Parser + reindex: `tracks`, `track_edges`, planned rows in `lessons`
  (status `planned`), `lessons.difficulty`, `lessons.depth`, and `lesson_edges` — cycle-checked,
  like track edges
- **Fundamental is derived, never stored:** a lesson other lessons depend on is fundamental; the
  more dependents, the more fundamental. Same for "unblocked": all prerequisites completed
- Curriculum screen: modules in order, each module's planned lessons with difficulty, depth,
  locked/unblocked state, and the fundamental badge
- Generation honours the plan: "teach me the next thing" targets the next unblocked planned
  lesson; the generated file claims its plan entry via `<meta name="mindforge:lesson">`

**Done when:** you press one button on a fresh mission and get a curriculum you'd actually follow,
every lesson placed, levelled, and wired to its prerequisites.

### M5 — Lessons in the product

**Goal:** read, finish, and move through lessons entirely in the app.

- Sandboxed lesson reader: separate origin, `sandbox="allow-scripts"` without `allow-same-origin`,
  strict CSP — lesson HTML is untrusted, always
- Completion + outcome (understood / shaky / lost) written from the reader; progress becomes
  completed-over-planned per module, and honest about plan revisions
- "Next lesson" honours dependencies and difficulty ordering; generating it is one press
- Reference-doc library (the documents you revisit), learning records browsable
- Focus sessions can bind to the lesson you were doing, so the time tracker knows what the time
  bought

**Done when:** you complete a full module — planned in M4, taught lesson by lesson — without
touching a terminal.

### M6 — The trackers, finished

**Goal:** progress, time, and frequency each answer their question at a glance — then deploy and
soak.

- **Progress:** curriculum overview — per-module fractions, outcomes distribution, what's
  unblocked next
- **Time:** minutes per curriculum/module/week, session history bound to lessons
- **Frequency:** the activity grid (intensity = minutes) and active-days-in-28, per user timezone
- Railway deploy (api + web), cloud Supabase, migrations on release — the M0 bullet that was
  deliberately deferred
- Then **use it for three weeks** on one real curriculum. That soak decides what, if anything,
  earns its way back from §5.

**Done when:** the deployed app has three weeks of real history and you can answer "how far, how
much, how often" for one curriculum without thinking.

---

## 5. Not building (and when that changes)

Cut in the v0.2 refocus. Each returns only if the focused flow is in daily use and the need is
felt there — not because the code was fun to write.

| Not now                                        | Was          | Revisit when                                                              |
| ---------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| Goals & typed targets                          | M1/M2, built | The curriculum's own progress proves insufficient motivation              |
| Skills, scores, decay, calibration, the galaxy | M1/M6/M7     | Lesson outcomes prove too coarse to answer "do I know this?"              |
| Friction tracking, ember/slag                  | M1/M2, built | You catch yourself wanting to log _why_ sessions die, three weeks running |
| Notes & highlights                             | M1, built    | You leave the app to write things down mid-lesson, repeatedly             |
| Resource library in-app                        | M1, built    | `RESOURCES.md` (agent-maintained, workspace-only) stops being enough      |
| Weekly planning & reviews                      | M2, built    | The frequency tracker shows you showing up but drifting                   |
| Spaced repetition / FSRS                       | M5 (planned) | A finished module fades and you feel it                                   |
| AI assessments & calibration                   | M6 (planned) | Self-reported outcomes stop being trustworthy                             |
| Insights & analytics beyond the three trackers | M8 (planned) | The trackers raise questions they can't answer                            |
| Integrations (Readwise, calendar, GitHub…)     | M9 (planned) | The flow is habitual and manual entry is the bottleneck                   |
| Multi-user, native apps, gamification          | Never-ish    | Unchanged from v0.1: the last one never — it corrupts the data            |

---

## 6. Sequencing rules

1. **M4 before any lesson UI.** The reader without the curriculum is a file viewer; the plan is
   what makes progress mean something.
2. **Cost tracking stays wired to every LLM call** — it already ships; never regress it.
3. **`packages/core` gets tests before it gets callers.** The dependency graph and progress maths
   are where a silent bug produces confidently wrong numbers.
4. **Each milestone ends with you using it**, not with the tests passing.
5. **M6 ends in a three-week soak.** Nothing from §5 gets revisited before that soak has happened.

---

## 7. Open questions to answer along the way

- **M4:** does the agent plan good lesson lists up front, or do plans need heavy revision by M5?
  (The revision rate is measurable: plan-entry churn per module.)
- **M5:** does completed-over-planned stay honest, or does plan churn make the fraction feel
  rigged? If the latter, show both numbers rather than blending them.
- **M6:** which tracker do you actually open? The other two must not grow features until the
  answer is known.
