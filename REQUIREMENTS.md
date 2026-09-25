# Mindforge — Product Requirements

**Status:** v0.2 — refocused on the curriculum flow
**Date:** 2026-08-10
**Author:** Renan
**Companions:** [`NORTHSTAR.md`](./NORTHSTAR.md) (destination & staircase) · [`TECH-DESIGN.md`](./TECH-DESIGN.md) (how)

> **v0.2 refocus.** v0.1 specified nine feature pillars. This revision cuts everything outside one
> flow: **curriculum → modules → lessons → progress · time · frequency.** The cut list and the
> conditions for return live in `NORTHSTAR.md` §5. Requirement IDs below are stable going forward;
> v0.1 IDs for cut features (FR-G\*, FR-S\*, FR-C\*, FR-V\*, FR-X\*, FR-W\*, FR-N\*…) are retired,
> not renumbered.

---

## 1. One-line pitch

Give Mindforge a topic and it plans a curriculum, teaches it lesson by lesson with an agent built
on the `teach` skill, and tracks the three things that matter: how far you are, how much time it
took, and whether you keep showing up.

---

## 2. The thesis (why this exists)

Learning a serious topic fails in two boring ways: you don't know what order to learn things in,
and you don't keep going. Most tools solve neither — they track _consumption_ (pages, videos,
streaks), which is a vanity metric.

Mindforge does two things instead:

1. **Structure.** An agent turns your mission into a curriculum: modules ordered
   fundamentals-first, and inside each module a planned lesson list where every lesson has a
   difficulty level, a depth level, and explicit dependencies. You always know what's next and
   why it's unblocked.
2. **Honest tracking.** Progress is completed-over-planned, never a feeling. Time is measured by
   the focus timer. Frequency is days-you-showed-up, not a streak with punishments.

**The `teach` skill teaches. Mindforge plans, sequences, remembers, and measures.** Lesson
generation is a Mindforge agent skill built on the upstream `teach` skill (Matt Pocock's) — the
app orchestrates it and never reimplements it.

---

## 3. Naming

**Decided: Mindforge.** (History and trademark notes in this file's v0.1.) The product name lives
in **one config constant**, never hardcoded in components or copy. The repo directory
(`brain-gym/`) can stay as-is — nothing depends on it.

---

## 4. Users & scope

### Primary persona: you (single-user, self-hosted-ish)

A working software engineer who wants to go deep on 2–3 topics and needs the path laid out and the
follow-through measured.

### Design consequences of being single-user first

- No social features, no sharing, no leaderboards.
- Multi-tenancy stays built in (auth, `user_id` on everything, RLS) so it _can_ open up later.
- The data is personal (what you struggle with, when you focus). Privacy is a first-class
  requirement.

### Non-goals (v1)

- ❌ Everything in `NORTHSTAR.md` §5 (goals, skills/scoring, friction, notes, resource library,
  weekly planning, SRS, assessments, insights, integrations)
- ❌ Being a task manager, note-taking app, or LMS
- ❌ Mobile-native apps (responsive web / PWA is enough)
- ❌ Replacing the `teach` skill's teaching loop

### The number-one product risk

**Abandonment at week three.** The mitigation is scope: one flow, two capture paths (the timer and
the lesson debrief), both under the ≤5s budget. A smaller honest product survives contact with a
busy week; a large one dies of its own weight.

---

## 5. Core domain concepts

| Concept             | Definition                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mission**         | _Why_ you're learning something, in your words. The root of one curriculum. Mirrors `teach`'s `MISSION.md`.                                           |
| **Curriculum**      | The agent-proposed structure of a mission: ordered modules, each with a planned lesson list. Canonical form is `CURRICULUM.md` in the workspace.      |
| **Module** (track)  | A subtopic with a one-line outcome. A module **is** a track — one entity, two words. Its lessons are planned up front, generated lazily.              |
| **Lesson**          | A unit of teaching. Planned first (slug, title, intent, difficulty, depth, dependencies), then generated on demand as a self-contained HTML artifact. |
| **Lesson edge**     | "A depends on B." Read forward it locks A until B is done; read backward it makes B **fundamental** for A. One edge, both readings.                   |
| **Difficulty**      | 1–5, set at planning time: how hard the lesson is expected to be for _you_, given the mission's stated current level.                                 |
| **Depth**           | `overview` / `working` / `deep_dive`: how far below the surface the lesson goes. Difficulty is how hard; depth is how far down.                       |
| **Outcome**         | Your ≤2-tap verdict on a completed lesson: `understood` / `shaky` / `lost`. Self-reported and labelled as such.                                       |
| **Focus Session**   | A bounded block of attention, usually on a lesson. Start with an intention, end with a ≤30s debrief.                                                  |
| **Learning Record** | Append-only record of a meaningful learning event, written by the agent. Mirrors `teach`'s `learning-records/`.                                       |
| **Reference doc**   | Agent-written document you _revisit_ (unlike lessons, which you complete). `reference/*.html` in the workspace.                                       |

**Relationship sketch:** `Mission → Curriculum → Modules → Lessons (+ edges) → Focus Sessions →
daily activity`. Progress reads off lessons; time reads off sessions; frequency reads off the
rollup.

---

## 6. Functional requirements

### 6.1 Authentication & accounts

- **FR-A1** Email + password auth, plus GitHub OAuth.
- **FR-A2** Session management, secure password reset, email verification.
- **FR-A3** All data scoped to a user; no cross-user reads possible by construction (RLS, tested).
- **FR-A4** Full data export (JSON + the workspace's own Markdown/HTML) and account deletion.

### 6.2 Missions

- **FR-M1** Create/edit a Mission: topic, why, success criteria, constraints, current level. Same
  shape as `teach`'s `MISSION.md` so they round-trip.
- **FR-M2** Mission history — when and why it changed (append-only revisions).
- **FR-M3** **WIP limit:** at most 10 active missions; others park. Parking a mission suspends
  nothing destructive — the curriculum and history stay. The limit was 3 until 2026-08-15 — the
  number that made this a rule about scatter rather than a runaway guard. It is now the second
  thing, deliberately; restoring the first means making it per-user with 3 as the default.

### 6.3 Curriculum & modules

- **FR-K1** One button on a mission proposes a curriculum: **8–15 modules**, ordered
  fundamentals-first, each with a slug, name, one-line outcome, and module-level prerequisites
  (a DAG, cycle-checked).
- **FR-K2** Each module carries a **planned lesson list**: slug, title, one-line intent,
  difficulty (1–5), depth (overview / working / deep_dive), and depends-on edges naming other
  planned lessons. Edges may cross modules only backwards (toward earlier modules); the graph is
  a DAG, cycle-checked.
- **FR-K3** `CURRICULUM.md` in the teach workspace is **canonical**; the DB is an index over it.
  Regenerating the curriculum revises the plan; modules absent from a regeneration are marked
  dropped, never deleted (their lessons are the expensive artifact).
- **FR-K4** The curriculum is grounded in the mission and in `RESOURCES.md` — a workspace file the
  agent maintains for its own grounding. `RESOURCES.md` is **not** indexed into the app and has no
  UI.
- **FR-K5** The curriculum screen shows modules in order; each module shows its planned lessons
  with difficulty, depth, locked/unblocked state, and completion state.
- **FR-K6** **Fundamental is derived:** a lesson with dependents is fundamental; the UI badges it
  and can rank by dependent count. Never stored, never hand-set.
- **FR-K7** **Unblocked is derived:** every dependency completed. The "next lesson" suggestion is
  the first unblocked, incomplete planned lesson in module order. Within a module, a lesson is never
  listed before one it depends on; among the lessons that could come next, the easiest comes first,
  then the plan's own order.

### 6.4 Lessons & the teach integration

- **FR-T1** Each mission maps to a teaching workspace (`MISSION.md`, `CURRICULUM.md`,
  `RESOURCES.md`, `lessons/`, `reference/`, `learning-records/`, `assets/`). Files are canonical;
  running `/teach` locally against the workspace keeps working.
- **FR-T2** Bidirectional sync between Storage and the DB index, with conflict retention — both
  versions kept, never silently resolved.
- **FR-T3** **Generate the next lesson from the app:** one press → briefing assembled from the
  mission, the curriculum position, recent learning records and lesson outcomes → the teach-based
  skill runs → the lesson lands in the module. Lessons are generated **one at a time, on demand**.
- **FR-T4** A generated lesson claims its plan entry via
  `<meta name="mindforge:lesson">` (and its module via `<meta name="mindforge:track">`) — from the
  lesson's own file, never from `CURRICULUM.md`, so membership survives a wholesale rewrite.
- **FR-T5** Render lessons in-app, sandboxed (separate origin, `allow-scripts` without
  `allow-same-origin`, strict CSP). Lesson HTML is untrusted, always.
- **FR-T6** Reference docs get their own browsable library; learning records are browsable and
  linked from their lessons.
- **FR-T7** Every LLM call writes an `llm_calls` row; a run's calls reconcile to its `modelUsage`.
- **FR-T8** **The learner can see what teaching has cost**, and a daily ceiling stops it running
  away. `llm_calls` recorded every call from M3 and nothing read the rows back: there was no total
  anywhere and no limit beyond the $5 cap inside a single run — while the single-active-run rule is
  per _mission_, so a learner with six missions had six runs' worth in flight. Today's spend and the
  ceiling are one calculation, used by the meter and by the refusal, so the two cannot disagree.
- **FR-T9** **An unpriced call is not a free call.** A model missing from the pricing table leaves
  `cost_usd` null; the total is then reported as a floor ("at least $4.10") with the count of what
  it could not price, and unmeasured spend never exhausts a budget — refusing on an estimate would
  mean telling a learner they had spent money nobody priced.

### 6.4b Exercises — lessons you do, not only read (`PLAN-HANDS-ON.md`)

- **FR-X1** A lesson may **declare exercises** in its own file, as
  `<script type="application/vnd.mindforge.exercise+json">` blocks validated against
  `ExerciseDeclarationSchema` in `packages/core`. The reindexer writes them onto the lesson's row
  (`lessons.exercises`); a block that fails the contract costs that exercise, never the lesson.
- **FR-X2** A lesson with exercises renders an **exercise panel beside the frame**: the prompt, an
  editor seeded with the starter, and "Run tests". A lesson with none renders exactly as before.
- **FR-X3** **Code runs in a sandboxed runner on the lessons origin**, never in the app and never in
  the lesson: its own frame (`allow-scripts` without `allow-same-origin`), its own CSP
  (`'unsafe-eval'` for this route only, `connect-src 'none'`), and a Blob worker killed after five
  seconds. JavaScript and TypeScript (transpiled, not type-checked), and Python on Pyodide
  (standard library only, served from the lessons origin, kept warm between runs, its start timed
  separately from the run).
- **FR-X4** A run shows each test's name, pass or fail, and its message. Code that will not load is
  an error the learner can act on, not a crash; a timeout says it stopped and why that usually
  happens.
- **FR-X5** **Every run is an attempt, recorded**, whatever it ended as. `passed` is derived by the
  server (`attemptPassed`) from the results the browser reported; attempts are append-only and
  keyed by lesson and exercise key, so a reindex never orphans them.
- **FR-X6** What the learner has done is shown honestly and derived on read: not tried, tried and not
  passed, passed on the first attempt, or passed with the total count. No celebration copy. The
  editor resumes from this device's draft, then the last attempt, then the starter; the reference
  solution is shown only when asked for.

- **FR-X7** **Whiteboard exercises** (`kind: "whiteboard"`): a design drawn on a canvas beside the
  lesson, against a prompt and a rubric of two to ten concrete, checkable items. The rubric and the
  reference design are **withheld by the server until the first review** — a checklist shown up front
  is the answer shown up front.
- **FR-X8** **A drawing is reviewed, not scored.** One Messages API call per submission reads the
  canvas as an image and as a structural description (`describeScene`) and answers covered, partly or
  missing for every rubric item, with a note on what it saw. The screen says it is an AI reviewer's
  feedback, not a grade. An answer that skips a rubric item is not shown — a verdict nobody gave is
  not filled in as "missing".
- **FR-X9** **A review is an attempt**, graded by the server and recorded as such
  (`graded_by = 'review'`, with the drawing and the bill): its results are the rubric items, and
  "passed" is every item covered — the same rule as tests — so the attempt summary, `lessonStrain` and
  adaptation treat a design exactly as they treat code. Billed and budgeted like a hint.

- **FR-X10** **Task exercises** (`kind: "task"`) for languages the browser cannot run: every file in
  full, the one command that runs the tests, and the learner's report of what happened. A report is an
  attempt graded by the learner (`graded_by = 'self'`) and shown as self-reported, never as a checked
  pass. With no clock behind it, a task can land too hard or in the zone, never too easy.

### 6.4c Hints — help when you're stuck, never the answer first (`PLAN-HANDS-ON.md` Phase 2)

- **FR-H1** **A ladder of five rungs** — a question, a clue, the idea, the shape of a solution, the
  code — asked for one at a time. The next rung is named on the button before it is pressed, and
  the server refuses a rung more than one above the highest given, so the code is never the first
  thing shown. Asking again at a rung already reached is allowed. The learner may also ask in their
  own words; that is answered at the rung they are on, not one higher.
- **FR-H2** A hint is one Messages API call (`packages/llm/src/hint.ts`), grounded in the exercise,
  its tests, the reference solution when there is one, the code in the editor and the last run, in
  the learner's content language (FR-L3). The system prompt is frozen for caching; everything that
  varies is in the user turn. Refusals fall back server-side; a refusal or an empty answer is never
  shown as a hint.
- **FR-H3** **Every hint given is recorded** (`exercise_hints`, append-only), and the attempt
  summary says how far up the ladder the learner went. A pass after being shown the code and a pass
  worked out alone are different results and never look alike.
- **FR-H4** **Every hint call is billed** (`llm_calls`, `purpose: exercise_hint`) — answered or not
  — and refused before calling when the day's teaching budget is spent (FR-T8, the same ceiling and
  meter as lesson runs). A failed call says which kind of failure it was: "not available" (no key,
  or a key refused or out of credit) or "try again" (rate-limited, overloaded, unreachable).

### 6.4d Difficulty adaptation — staying in the zone (`PLAN-HANDS-ON.md` Phase 3)

- **FR-D1** **Every finished lesson is judged** too hard, in the zone or too easy, from what the
  learner did — attempts, hints, time — and the outcome they recorded (`lessonStrain` in
  `packages/core`, derived on read, never stored). Too hard: marked lost, an exercise tried and never
  passed, or a pass only after rung 4 or 5. Too easy: every exercise passed first try, no hint before
  the pass, in at most half the expected minutes — with the timing known — and not marked shaky or
  lost. An unfinished lesson is `in-progress`, and nothing-to-judge is its own state; neither is ever
  shown as "in the zone". Every verdict carries its reasons.
- **FR-D2** **Too hard → a bridge, never a rewrite.** The next lesson is a smaller step toward it; the
  lesson itself and everything the learner did with it stay. One bridge per lesson. The learner can
  also ask for one ("Try an easier version") on any lesson that landed too hard.
- **FR-D3** **Two too-easy lessons in a row → the next is pitched a step harder** than the plan says.
  One is chance; two is the plan pitched low.
- **FR-D4** **Adaptation is always visible.** A lesson declares what it changed in its own file
  (`mindforge:adjusted`, `mindforge:bridge-for`, `mindforge:adjusted-reason`); the curriculum screen
  shows each verdict with its reasons, each bridge and push with its reason, and what the next lesson
  will do — the same `nextAdjustment` the run's briefing is given, so the screen and the agent cannot
  disagree.

### 6.5 Progress tracker

- **FR-P1** Lesson completion is recorded from the reader with an outcome:
  `understood` / `shaky` / `lost`, ≤2 taps.
- **FR-P2** **Module progress = completed / planned**, shown with the plan visible. When the plan
  is revised, the fraction changes and the revision is visible — the number never quietly moves.
- **FR-P3** Curriculum progress = modules done and the per-module fractions. A module is done when
  all its planned lessons are completed (a dropped plan entry leaves the denominator). The mission's
  own figure is a fraction of **lessons, not modules** — modules run from three lessons to eight, and
  counting them would make finishing a short one worth more than finishing a long one. It covers only
  the modules that have a plan, and reports how many it could not count, so a fraction over part of a
  mission is never presented as a fraction over all of it.
- **FR-P4** Outcomes are shown per module (how many understood / shaky / lost). A shaky lesson
  counts as completed but stays visibly shaky — honesty over encouragement.
- **FR-P5** "Unknown" is never rendered as zero. A module with no plan yet says so; it does not
  show 0%.

### 6.6 Time tracker (focus)

- **FR-F1** Timer with start/stop: start takes one field — the intention ("what does done look
  like?"). Stop takes a ≤30s debrief: hit it (yes/partly/no), focus quality (1–5), energy (1–5).
- **FR-F2** Manual and retroactive entry — you _will_ forget the timer, and backfilled data is
  distinguishable but never second-class.
- **FR-F3** A session binds to a mission, and (once lessons render in-app) to the lesson you were
  doing. Binding is optional and never asked twice.
- **FR-F4** Time views: minutes per curriculum/module/week, session history. Derived on read.
- **FR-F5** **Opening a lesson times it.** The reader starts a session on the lesson it is showing
  and ends it when you leave — reading is activity, and a lesson read without pressing start used to
  render as a rest day. It records real elapsed time and never invented minutes, and it is recorded
  as its own entry mode: time the reader was open is a weaker claim than time you declared you were
  focusing, and FR-F2's rule applies one step further out. Because the lesson is a cross-origin frame
  the app cannot see reading, so the measurement is bounded rather than trusted — it settles before
  starting, stops on a hidden tab, and caps.

### 6.7 Frequency tracker

- **FR-Q1** **Activity grid:** a year of days, intensity = focus minutes, in the user's timezone.
  No streak counter; the companion figure is **active days in the last 28**, which recovers
  naturally and can't be broken by one bad week.
- **FR-Q2** Nightly rollup into `daily_activity` per user timezone; the grid reads the rollup,
  never raw sessions. The rollup is a cache — rebuildable from raw rows at any moment, and the
  only exemption to "derived numbers are computed on read".

---

## 7. Cross-cutting requirements

### 7.1 Capture friction budget

Any routine capture action — starting/stopping the timer, the debrief, the lesson outcome — takes
**≤5 seconds and ≤2 taps**. Anything slower is automated or removed.

### 7.2 Honesty over encouragement

When progress is bad, the app says so, plainly, once. No fake celebration, no inflated numbers, no
hidden nothing-happened weeks.

### 7.3 Data ownership & privacy

Full export in open formats; the workspace is already yours (Markdown + HTML in Storage). Explicit
labelling of what is sent to an LLM provider and when.

### 7.4 Internationalization

Unchanged from v0.1 — en + pt-BR, and three separate settings:

- **FR-L1** UI locale (`en`, `pt-BR`) — strings, dates, numbers.
- **FR-L2** Timezone (IANA) — every "day" and the nightly job derive from it.
- **FR-L3** Content language — what the agent writes lessons in; independently overridable.
- **FR-L4** Week start seeded from locale (pt-BR: Sunday) — the grid's columns depend on it.
- **FR-L5** A missing translation key fails the build.

### 7.5 The response contract

One declaration of every response shape, in `packages/core`, which the API derives its return types
from and the SPA parses against. It was two declarations linked by a comment until 2026-08-15 — a
field renamed on the server left lint, typecheck, the boundary rules and every unit suite green, and
broke a screen at runtime. Unknown keys are stripped so a server may add a field; a field that
_disappears_ is an error naming the field.

### 7.6 Offline & mobile

Timing focus must work on a phone and survive a flaky connection (offline queue with
client-generated UUIDs). Reading lessons and browsing the curriculum can be desktop-first.

### 7.7 Accessibility & performance

Keyboard-first navigation (command palette on desktop), WCAG AA, dark/light themes, fast cold
start. Lesson HTML must render legibly in both themes and at 375px.

---

## 8. Success metrics

1. **Still in use after 90 days.** Everything else is moot.
2. **One full module completed end to end** through the app.
3. **The three trackers answer their questions at a glance** — how far, how much, how often.

---

## 9. Risks & open questions

| Risk                                                  | Mitigation                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The agent plans bad lesson lists                      | Plans are revisable and revision churn is measurable (NORTHSTAR §7); grounding in `RESOURCES.md`    |
| Completed-over-planned feels rigged when plans change | Show the revision, not just the new fraction (FR-P2); if it still feels rigged, show both numbers   |
| Lesson HTML is untrusted, LLM-authored code           | FR-T5 sandbox, never relaxed                                                                        |
| Sync conflicts (files ↔ DB)                           | Files canonical; conflict retention; never silently overwrite                                       |
| LLM cost                                              | `llm_calls` on every call, reconciled per run; caching per TECH-DESIGN §8                           |
| The app becomes a procrastination surface             | One flow; the home screen's job is getting you into the next lesson or a focus session in one click |

Open questions live in `NORTHSTAR.md` §7.

---

## 10. Glossary

- **Module / track** — one entity, two words: a curriculum subtopic whose lessons form its module.
- **Planned lesson** — a curriculum entry (slug, title, intent, difficulty, depth, edges) whose
  file may not exist yet.
- **Fundamental lesson** — a lesson other lessons depend on. Derived from edges, never stored.
- **Unblocked lesson** — a planned lesson whose dependencies are all completed.
- **Depth** — overview / working / deep_dive: how far below the surface a lesson goes.
- **Difficulty** — 1–5: how hard the lesson is expected to be for you.
- **Outcome** — understood / shaky / lost: your verdict on a completed lesson.
- **Zone of Proximal Development (ZPD)** — the band where a lesson is hard enough to teach and
  easy enough to finish. Difficulty levels aim at it.
