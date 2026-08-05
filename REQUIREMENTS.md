# Mindforge — Product Requirements

**Status:** Draft v0.1
**Date:** 2026-08-05
**Author:** Renan
**Next doc:** `TECH-DESIGN.md` (technical requirements — to be written after this is agreed)

---

## 1. One-line pitch

A personal system that turns scattered learning inputs (lessons, books, podcasts, articles) and scattered attention into **measured, compounding skill** — by tracking where your effort goes, where it sticks, and where friction is eating you alive.

---

## 2. The thesis (why this exists)

Most learning tools track *consumption*: pages read, videos watched, streaks kept. Consumption is a vanity metric. You can finish a book and retain nothing.

Mindforge tracks three things instead:

1. **Attention spent** — focus time, on what, planned vs. actual.
2. **Retention demonstrated** — evidence you can still do the thing, days and weeks later.
3. **Cognitive friction** — the resistance you hit, and crucially, *which kind*.

The third one is the differentiator, and it needs a sharp definition or it becomes a mood-tracker. Splitting friction into two types:

| Type | What it is | Signal | Goal |
| --- | --- | --- | --- |
| **Productive friction** (desirable difficulty) | Effortful retrieval, struggling before being told, spaced/interleaved practice. Feels bad, builds storage strength. | High effort + eventual success + retention later | **Increase** |
| **Wasteful friction** | Interruptions, context switching, bad tooling, unclear source material, wrong difficulty level, decision fatigue about what to study | High effort + no learning gain + abandonment | **Eliminate** |

This maps directly onto the `teach` skill's core split (*fluency strength* = illusory in-the-moment recall vs. *storage strength* = real long-term retention). Mindforge's job is to make that split **visible and measurable** over months, which a per-session teaching agent cannot do on its own.

**The `teach` skill teaches. Mindforge remembers, schedules, measures, and holds you accountable.**

---

## 3. Naming

**Decided: Mindforge.** The metaphor fits — heat and hammering are resistance that shapes, which is the productive-friction thesis in physical form.

The original working name, *Brain Gym*, was dropped: "Brain Gym®" is a trademarked educational-kinesiology program widely regarded as pseudoscience and publicly debunked. For an app whose entire pitch is evidence-based learning, that association was a liability.

Two things to watch with Mindforge, neither blocking:

- **"Mind-" is a crowded prefix** in AI learning tools (Mindstone, Mindgrasp, Mindsmith all exist). Check trademark and domain before any public launch.
- **Forging is a one-time transformation**, while this product is about repeated practice and decay. If the metaphor ever feels wrong in the UI, lean on the *tempering* side of smithing — repeated heat-and-stress cycles that make steel stronger and less brittle — which maps exactly onto desirable difficulty and spaced repetition.

**Implementation rule:** the product name lives in **one config constant**, never hardcoded in components or copy. The repo directory (`brain-gym/`) can stay as-is or be renamed independently — nothing depends on it.

---

## 4. Users & scope

### Primary persona: you (single-user, self-hosted-ish)
A working software engineer with more inputs than time, multiple half-finished books, a podcast backlog, a desire to go deep on 2–3 skills, and no reliable read on whether any of it is working.

### Design consequences of being single-user first
- No social feed, no leaderboards, no sharing in v1.
- Multi-tenancy is still built in (auth, `user_id` on everything) so it *can* open up later — but no feature is designed around other people existing.
- Data is personal and sensitive (what you're bad at, when you focus, what you abandon). Privacy is a first-class requirement, not a checkbox.

### Non-goals (v1)
- ❌ Social features, sharing, public profiles, teams
- ❌ Being a general-purpose task manager or note-taking app (it integrates with what you have; it doesn't replace Obsidian/Todoist)
- ❌ Being a full LMS / course marketplace
- ❌ Mobile-native apps (responsive web / PWA is enough)
- ❌ Real-time collaboration
- ❌ Replacing the `teach` skill's teaching loop — Mindforge orchestrates it, it doesn't reimplement it

### The number-one product risk
**Manual data entry kills tracking apps.** It would be deeply ironic for a cognitive-friction app to be a source of cognitive friction. Every feature below is subject to one test: *can this be captured in under 5 seconds, or automatically?* If not, cut it or automate it. This is the hardest constraint in the doc and the one most likely to be quietly violated.

---

## 5. Core domain concepts

These are the nouns the whole app is built from. Getting these right matters more than any screen.

| Concept | Definition |
| --- | --- |
| **Mission** | *Why* you're learning something, in your words. Grounds everything. One per learning track. Mirrors `teach`'s `MISSION.md`. |
| **Goal** | A concrete, dated, observable outcome under a Mission ("ship a Rust CLI by Oct 1", "finish DDIA ch. 1–9"). |
| **Skill** | A trackable competency ("React Server Components", "Portuguese subjunctive"). Has a **score** with a confidence level and a decay curve. Skills form a graph (prerequisites). |
| **Resource** | Anything you learn *from*: book, podcast episode, article, video, course, docs. Has type-specific progress. |
| **Lesson** | A unit of teaching generated by the `teach` skill — a self-contained HTML artifact tied to a Mission. |
| **Learning Record** | An append-only record of a meaningful learning event: what was learned, evidence, key insight, struggles, what it unlocks. Direct mirror of `teach`'s `learning-records/`. **The system of record for progress.** |
| **Focus Session** | A bounded block of attention on one Task/Resource/Lesson. Planned or ad-hoc. Produces friction and outcome data. |
| **Task** | A specific piece of work to focus on ("read DDIA ch.4", "do lesson 0007", "build the parser"). The thing a Focus Session points at. |
| **Study Plan** | A sequence/schedule of Lessons, Resources, and Tasks that advances a Goal. |
| **Assessment** | An AI-generated (or manual) test of a Skill, producing evidence and a score update. |
| **Review Item** | A single retrievable fact/skill scheduled for spaced repetition. |
| **Friction Event** | A logged instance of resistance, typed and rated, attached to a Focus Session. |
| **Artifact** | Real-world proof of skill: a PR, a project, a talk, a conversation. The `teach` skill's *wisdom* pillar. |

**Relationship sketch:** `Mission → Goals → Study Plans → (Lessons | Resources | Tasks) → Focus Sessions → Friction Events + Learning Records → Skill scores → Insights`. Assessments and Review Items feed Skill scores independently of consumption.

---

## 6. Functional requirements

### 6.1 Authentication & accounts
- **FR-A1** Email + password auth, plus at least one OAuth provider (GitHub or Google).
- **FR-A2** Session management, secure password reset, email verification.
- **FR-A3** All data scoped to a user; no cross-user reads possible by construction.
- **FR-A4** Full data export (JSON + Markdown) and account deletion. You own your learning history — this is non-negotiable given how personal the data is.
- **FR-A5** *(v2)* Optional 2FA/passkeys.

### 6.2 Missions & Goals
- **FR-M1** Create/edit a Mission: topic, why, what success looks like, constraints, current level. Same shape as `teach`'s `MISSION.md` so they can round-trip.
- **FR-M2** Mission history — when and why it changed. Mission drift is a real signal, not noise.
- **FR-M3** Goals under a Mission: title, definition of done, target date, and one or more **typed targets** — finish a Resource to N%, bring a Skill to a band, ship an Artifact, spend N focus hours, hold N% review accuracy, complete N lessons, or a manual escape hatch. **Progress is computed from those targets, never entered.** There is no percentage field and no slider. A goal with no targets says so rather than showing a made-up number. (Derivations in `TECH-DESIGN.md` §3.8.)
- **FR-M3b** A `skill_band` target reads the **decayed** score, so a met goal can un-meet itself when the skill fades. That is correct, and the app says it plainly rather than hiding it.
- **FR-M4** **WIP limit / anti-scatter:** cap on simultaneously *active* Missions (default 3). Others go to a "parked" state. Trying to exceed it prompts you to park something. Scatter is the main failure mode of ambitious learners.
- **FR-M4b** **Parked ≠ archived.** A parked Mission keeps decaying (skills don't know you parked it) and keeps its history in insights, but its review items are **suspended by default**, its decay warnings are silenced, and its goals freeze rather than nag. Unparking restores real due dates and offers to spread the backlog over two weeks. (`TECH-DESIGN.md` §5.3.)
- **FR-M5** Anti-goals: explicitly listed things you've decided *not* to learn right now, so they stop generating guilt and re-litigation.

### 6.3 Skills & scoring
- **FR-S1** Skill library with a prerequisite **graph** (not a flat list) — enables "you can't do X until Y", and powers the ZPD recommendation.
- **FR-S2** **Evidence-backed scores.** A Skill score is computed from evidence events (assessment results, review performance, completed lessons, shipped artifacts, teach-backs) — *not* from self-rating alone. Self-rating is stored separately as `perceived_level`.
- **FR-S3** **Score has a confidence interval.** "React Server Components: 62 ±18, last evidence 34 days ago" is honest. A bare "62" is a lie.
- **FR-S4** **Decay.** Scores decay over time without retrieval, per a half-life model. A skill you haven't touched in 6 months should visibly fade. This alone makes the dashboard more honest than any competitor.
- **FR-S5** **The calibration gap.** Track `perceived_level - demonstrated_level` per skill. This *is* the fluency-vs-storage illusion, made into a number. Overconfidence is the highest-value thing this app can show you.
- **FR-S6** Skill levels use named bands, not naked numbers (e.g. *Aware → Assisted → Working → Fluent → Teaching*). Bands need explicit, written criteria.

### 6.4 `teach` skill integration
This is the app's engine. Requirements here are deliberately concrete because the skill is file-based and stateful.

- **FR-T1** Each Mission maps to a **teaching workspace directory** (the `teach` skill's unit of state: `MISSION.md`, `RESOURCES.md`, `learning-records/`, `lessons/`, `reference/`, `assets/`, `NOTES.md`).
- **FR-T2** **Bidirectional sync.** Files remain a valid source of truth — you must be able to run `/teach` in a terminal against the workspace and have Mindforge pick up the changes (new lessons, new learning records, updated mission). Equally, changes made in the UI must be written back to the files. *Files are canonical; the DB is an index over them.* (Alternatives are evaluated in the tech doc — this is the recommended default.)
- **FR-T3** **Generate a lesson from the app**: pick a Mission → app assembles context (mission, recent learning records, current ZPD estimate, weak skills, due review items) → invokes the `teach` skill → new lesson appears in the library.
- **FR-T4** **Render lessons in-app.** Lessons are self-contained HTML; serve them sandboxed (see §9 Security). Preserve the `teach` skill's design intent — they're meant to be beautiful and printable.
- **FR-T5** **Reference documents** (`reference/*.html`) get their own browsable, searchable library — the skill explicitly notes these are the artifacts you *revisit*, unlike lessons.
- **FR-T6** **Learning Records are first-class in the UI** — creatable, browsable, linkable, searchable. Their `Next` section feeds the recommendation engine directly.
- **FR-T7** **ZPD assistance.** The app computes and shows a "what to learn next" candidate set from learning records, skill graph gaps, and due reviews — and passes it to `teach` as context so the agent starts warm instead of re-deriving state every session.
- **FR-T8** **RESOURCES.md ↔ Resource library** are the same data. Resources tracked in the app (books, podcasts, articles) appear as grounding sources for teaching; sources the agent finds appear in your library. Includes the *Explored But Rejected* list.
- **FR-T9** Lessons record completion + a quick outcome (understood / shaky / lost), which is a scoring evidence event.

### 6.5 Learning sources (books, podcasts, articles, courses, videos)
- **FR-R1** Unified `Resource` model with type-specific progress: books → pages/chapters/%, podcasts & video → timestamp/duration, articles → read/unread + time-to-read, courses → modules.
- **FR-R2** **Frictionless capture** — the make-or-break feature. Minimum: paste-a-URL auto-fetches title/author/type/reading time. Ideally: browser extension / share target / bookmarklet. An "Inbox" for uncategorized captures, triaged later.
- **FR-R3** Link Resources → Skills and Missions. An article you'll never connect to a goal is entertainment; the app should be honest about that.
- **FR-R4** Highlights & notes per Resource, with location (page/timestamp). **A highlight can be promoted to a Review Item in one tap** — this is the bridge from consumption to retention. Highlights are a special case of the universal note (§6.14).
- **FR-R5** Statuses: `inbox → queued → active → finished | abandoned | reference`. **Abandoning is a first-class, guilt-free action with an optional reason** — abandonment reasons are prime friction data.
- **FR-R6** **Backlog health / "learning debt".** Surface how much is queued vs. throughput, average age of the backlog, and started-but-stalled items. A backlog growing faster than you consume is a signal you need, not a shame you hide.
- **FR-R7** *(v2)* Integrations: Readwise/Kindle highlights, Pocket/Instapaper, Spotify/Apple Podcasts history, YouTube watch history, RSS.

### 6.6 Focus time
- **FR-F1** **Timer** with start/stop/pause, always bound to a Task (which may point at a Lesson, Resource, Goal, or free-form work). Pomodoro-style intervals optional, not mandatory.
- **FR-F2** **Manual entry & retroactive logging** — you *will* forget to start the timer. If backfilling is painful, the data dies within two weeks.
- **FR-F3** **Session start:** one field — intention ("what does done look like for this block?"). **Session end:** a ≤30-second debrief — did you hit it (yes/partly/no), focus quality (1–5), energy (1–5), friction encountered.
- **FR-F4** **Interruption / friction logging mid-session**: one tap, typed (see §6.7), no modal, no typing required. Optional one-line note.
- **FR-F5** **Weekly planning:** allocate target focus hours per Mission/Skill for the week, on a calendar-like grid. Plan vs. actual is the core weekly insight.
- **FR-F6** **Weekly review ritual** — a guided end-of-week screen: planned vs. actual, what moved, what stalled, biggest friction sources, next week's allocation. This is the habit loop that keeps the app alive; without a ritual, tracking apps are abandoned in 3 weeks.
- **FR-F7** *(v2)* Calendar integration — push planned focus blocks to Google Calendar so plans occupy real time, and pull meetings so the plan is realistic.
- **FR-F8** *(v2)* Optional automatic time capture (IDE/browser activity) to reduce entry burden — strictly opt-in, local-first.

### 6.7 Cognitive friction tracking
The heart of the product. Needs to be structured enough to analyze, cheap enough to actually log.

- **FR-C1** **Friction taxonomy** (typed, tappable — start with these, refine with real data):
  - *Interruption* (external — person, notification, meeting)
  - *Self-interruption* (you context-switched)
  - *Too hard* (above ZPD — lost, no foothold)
  - *Too easy* (below ZPD — bored, no learning)
  - *Unclear material* (the resource is bad, not you)
  - *Tooling/environment* (setup, config, broken thing)
  - *Missing prerequisite* (blocked by an unlearned skill → **should auto-suggest adding that Skill/lesson**)
  - *Decision fatigue* (couldn't decide what to work on)
  - *Motivation/avoidance* (didn't want to start)
  - *Physical* (tired, hungry, unwell)
  - *Productive struggle* (hard, but you were making progress — **the good kind**)
- **FR-C2** Each event: type, intensity (1–5), optional note, auto-attached to session/task/resource/skill and timestamp.
- **FR-C3** **Friction is classified productive vs. wasteful** (by type, plus outcome: did the session still produce learning?). The dashboard shows the ratio and its trend.
- **FR-C4** **Friction → action.** Recurring wasteful friction generates suggestions: "*Tooling* friction is 40% of your Rust sessions — spend one session fixing your environment." "*Too hard* is spiking on RSC — insert a prerequisite lesson." Friction data that produces no action is just a diary.
- **FR-C5** Avoidance/procrastination signals: planned-but-never-started blocks, repeatedly rescheduled tasks, items that sit in "active" untouched. These are friction you never explicitly logged.

### 6.8 Study plans
- **FR-P1** Build a plan for a Goal: an ordered/scheduled mix of Lessons, Resources, Tasks and Assessments, with a target date and estimated effort.
- **FR-P2** **AI-assisted plan generation** — from a Mission + current skill state + available weekly hours, propose a plan. Always editable; never binding.
- **FR-P3** **Adaptive:** plans reschedule when you fall behind, and *say so honestly* ("at your last 3 weeks' pace this finishes 5 weeks late — cut scope or add 2h/week"). No silent optimism.
- **FR-P4** **Interleaving support** — plans deliberately mix related topics rather than blocking them, per the `teach` skill's guidance (skills practice only, not initial knowledge acquisition).
- **FR-P5** **Spacing built into the plan** — revisits are scheduled items, not an afterthought.
- **FR-P6** Templates: "read a technical book properly", "learn a language framework", "prep for a talk".

### 6.9 Spaced repetition / review queue
*Not in the original list, but the `teach` skill's entire philosophy (spacing, retrieval practice, storage strength) is inert without it. This is what makes skill scores mean something.*

- **FR-V1** **Daily review queue** of due Review Items across all Missions.
- **FR-V2** Items created from: lesson quiz questions, promoted highlights, learning-record key insights, manual entry, assessment questions you got wrong.
- **FR-V3** A real scheduling algorithm (FSRS or SM-2-family), tuned to your actual recall data.
- **FR-V4** Item types beyond flashcards: recall prompts, "explain this in your own words" (AI-graded), small code/practice tasks.
- **FR-V5** Review performance is a primary input to Skill score and decay — **this is the retention evidence loop**.
- **FR-V6** Hard cap on daily review load, with overflow handling. Anki death-by-backlog is a known failure mode and a direct source of wasteful friction.

### 6.10 Assessments & tests
- **FR-X1** **AI-generated tests** for a Skill at a target level, drawing on your actual lessons, learning records and resources — not generic trivia.
- **FR-X2** Mixed formats: multiple choice, short answer, "explain it", applied/code tasks, "spot the bug", scenario judgment.
- **FR-X3** **Confidence-rated answers.** Before revealing the result, you state your confidence. This yields the **calibration score** (FR-S5) — measuring not just what you know, but whether you know what you know. Highest-signal, lowest-cost feature in the doc.
- **FR-X4** Results produce: score update + evidence event + a **generated Learning Record draft** + new Review Items for what you missed + suggested next lessons.
- **FR-X5** **Baseline + periodic re-test** per skill, so progress is measured against your own prior self, not an absolute scale.
- **FR-X6** **Quiz answer hygiene**: per the `teach` skill, options must be the same length and formatting so you can't pattern-match your way to a right answer. Enforce this in generation and validation.
- **FR-X7** Human review escape hatch: flag a bad/wrong AI question. AI-generated assessments *will* be wrong sometimes; the app must not silently score you on garbage. Flagged questions are excluded from scoring.
- **FR-X8** **Teach-back mode:** explain a concept out loud/in writing; AI grades against the reference doc and learning records. Feynman technique as a graded assessment type — the strongest evidence of real understanding short of shipping something.

### 6.11 Artifacts & real-world evidence (the *wisdom* pillar)
- **FR-W1** Log real-world applications: a PR, a project, a talk, a blog post, a conversation, a class attended.
- **FR-W2** Artifacts are the **highest-weight evidence** for a Skill score. Nothing beats "I built the thing".
- **FR-W3** Track communities joined/participated in (per the `teach` skill's wisdom guidance) — a gentle nudge when a skill has plenty of lessons but zero real-world contact.
- **FR-W4** *(v2)* GitHub integration to auto-suggest artifacts from merged PRs.

### 6.12 Insights & dashboards
Every insight must answer *"so what do I do differently?"*. Anything that doesn't gets cut.

- **FR-I1** **Home / today:** what to focus on now, reviews due, current plan step, active mission, today's planned blocks.
- **FR-I2** **Focus analytics:** hours by mission/skill/week, plan vs. actual, session length distribution, best time-of-day and best-conditions analysis ("your focus quality is 40% higher before 11am — protect that window").
- **FR-I3** **Friction analytics:** wasteful vs. productive ratio over time, top friction sources, friction by mission/time-of-day/resource, and *specific* recommended actions.
- **FR-I4** **Learning analytics:** retention curves, review accuracy trends, skill scores with confidence and decay, calibration gap per skill, ZPD hit-rate (how often lessons land at the right difficulty).
- **FR-I5** **Consumption vs. retention** — the app's signature chart. Hours in vs. demonstrated skill out, per mission. Reveals which activities are actually working and which are comfortable time-passing.
- **FR-I6** **Progress toward goals:** derived, honest, with projected completion dates based on real pace.
- **FR-I6b** **Activity grid.** A year of days as a heatmap, with the familiar shape but not the familiar semantics: **intensity is focus minutes, hue is ember share**, so a heavy grey day reads as effort that produced little rather than as a good day. Switchable layers (focus, reviews, lessons, notes, artifacts). No streak counter — the companion figure is **active days in the last 28**, which recovers naturally and can't be broken by one bad week. Ships with one derived line naming an action, per §7 (`TECH-DESIGN.md` §3.9).
- **FR-I7** **Backlog & debt:** queue growth vs. throughput, abandonment rate and reasons, stalled items.
- **FR-I8** *(v2)* **AI narrative digest** — a weekly written summary ("you spent 6.5h on Rust, mostly reading; retention checks say your ownership model is still shaky — next week do lessons, not chapters"). This is what makes the numbers land.

### 6.13 Notifications & nudges
- **FR-N1** Review due, planned block starting, weekly review time, goal deadline approaching.
- **FR-N2** **Decay warnings** — "you're about to lose Rust lifetimes; 10 minutes of review saves it."
- **FR-N3** Stall detection — "no session on this mission in 12 days. Still active, or park it?"
- **FR-N4** All notifications configurable and quiet by default. A nagging app gets muted, then deleted.
- **FR-N5** Streaks, if present, must be **forgiving** (rest days, weekly rather than daily targets). Punishing streaks create anxiety and gaming, which corrupts the very data this app exists to collect.

---

### 6.14 Notes
Notes attach to anything the app models. They are **inputs to the system, not an archive** — that distinction is what keeps this from becoming the note-taking app listed in the non-goals (§4).

- **FR-N1** Attach a note to any subject: Mission, Goal, Skill, Resource, Lesson, Reference doc, Learning Record, Focus Session, Assessment, Artifact. A `standalone` escape hatch exists for the genuinely unfiled thought.
- **FR-N2** A **highlight is a note with a quote and a locator** (page, timestamp, selector) — one concept, not two features.
- **FR-N3** **One-tap capture during a focus session.** The note auto-attaches to the session and, through it, to the task and mission. No picker, no filing — subject to the ≤5s budget like every other capture path.
- **FR-N4** **Any note promotes to a Review Item in one tap.** A thought you had while reading becomes something you're tested on.
- **FR-N5** **Notes feed lesson generation.** Notes on a Mission's skills and resources are summarised into the agent's briefing, so what you wrote while reading shapes what you're taught next. This is the strongest reason to keep notes in-app rather than in Obsidian.
- **FR-N6** Full-text search across all notes. This is the entire retrieval story.
- **FR-N7** Markdown body, pin/unpin, edit history not required.
- **FR-N8** Notes on a Mission's subjects sync into that mission's teaching workspace as Markdown, so they survive outside the app and the agent can read them.
- **Explicitly out of scope:** backlinks, `[[wikilinks]]`, graph view, daily notes, nested pages, templates. These turn a notes feature into a second product.

---

## 7. Cross-cutting requirements

### 7.1 Capture friction budget
Any routine capture action must take **≤5 seconds and ≤2 taps**. Anything slower must be automated, inferred, or removed. This is a hard requirement, testable per feature.

### 7.2 Honesty over encouragement
When progress is bad, the app says so — plainly and without moralizing. No fake celebration, no inflated scores, no hiding decay. The product's only real value is being the one place that tells you the truth about your learning.

### 7.3 Goodhart resistance
Every metric will be gamed if it becomes a target — including by you, unconsciously. Mitigations: prefer *derived* metrics over self-reported ones; weight retention and artifacts above hours; show hours alongside retention so hours alone can never look like success; never rank or reward raw consumption.

### 7.4 Data ownership & privacy
Full export in open formats; local/self-hostable deployment as a first-class option; explicit consent for anything that leaves the machine; clear labelling of what is sent to an LLM provider and when. This data is a map of your weaknesses — treat it accordingly.

### 7.4b Internationalization
The app ships in **English and Brazilian Portuguese**, with three settings kept deliberately separate:

- **FR-L1** **UI locale** (`en`, `pt-BR`) — interface strings, dates, numbers. Seeded from the browser, user-overridable.
- **FR-L2** **Timezone** (IANA) — every "day", "week", nightly job, and the activity grid derives from it, never from server-local time.
- **FR-L3** **Content language** — the language the agent writes lessons, assessments, and briefings in. Defaults to the UI locale but is **separately overridable**: a pt-BR interface with English lessons is a legitimate and likely combination, because the source material and community for most technical topics are English.
- **FR-L4** Search stems by the language of the **content**, not the UI.
- **FR-L5** **Week start** is a user preference seeded from locale (pt-BR: Sunday), because the weekly plan and every "this week" rollup depend on it.
- **FR-L6** The domain glossary (ember/slag, temper bands, friction types) is translated **once** in one place and derived everywhere, so the vocabulary can't drift between screens.
- **FR-L7** A missing translation key fails the build. It never renders as a raw key to the user.

### 7.5 Offline & mobile
Reading, timing focus, and doing reviews must work on a phone and survive a flaky connection. Authoring and analytics can be desktop-first.

### 7.6 Accessibility & performance
Keyboard-first navigation (a command palette is a strong fit for this app), WCAG AA, dark/light themes, fast cold start. Lesson HTML must render legibly in both themes.

---

## 8. Success metrics (for the app itself)

Judge Mindforge by these, in order:

1. **Still in use after 90 days.** Tracking apps die at week 3. Everything else is moot.
2. **Retention lift** — review accuracy and re-test scores trend up on active skills.
3. **Wasteful friction down, productive friction up** — the ratio moves in the right direction.
4. **Plan adherence** improves, or plans become more honest (both are wins).
5. **Artifacts produced** — real things shipped per quarter, per mission.
6. **Calibration gap shrinks** — you get better at knowing what you actually know.

---

## 9. Risks & open questions

### Risks
| Risk | Mitigation |
| --- | --- |
| **Data entry burden kills it** | §7.1 friction budget; automation and integrations prioritized early; retroactive logging must be painless |
| **Feature sprawl** — this doc is ambitious | Strict MVP (§10); ship the smallest loop that produces a true insight |
| **AI-generated tests are wrong or shallow** | Ground generation in your own lessons/records; flag-and-exclude (FR-X7); prefer applied and explain-it formats over trivia |
| **Metrics get gamed** | §7.3 |
| **Lesson HTML is untrusted, LLM-authored code** | Render sandboxed (iframe, restrictive CSP, no ambient credentials, no same-origin access to the app) — details in the tech doc |
| **`teach` skill changes shape** | Treat the file formats as an integration contract; parse defensively; never lose file content on sync |
| **Sync conflicts (files ↔ DB)** | Files canonical; conflict detection with an explicit resolution UI; never silently overwrite |
| **LLM cost** | Cache aggressively; batch generation; user-visible cost/usage counter |
| **The app becomes a procrastination surface** — organizing learning instead of learning | Hard limits on planning UI depth; the home screen's job is to get you *into* a focus session in one click |

### Open questions
1. **Self-hosted-only, or hosted with accounts?** This decides auth complexity, cost model, and how the file-based `teach` workspaces are stored (local FS vs. object storage). ← *biggest fork; blocks the tech doc*
2. **Is the `teach` skill invoked via Claude Code locally, or via the Claude API from a server?** The skill is a local file-based Claude Code skill today. Running it server-side means reimplementing the harness or running the CLI headless.
3. **Files canonical, DB canonical, or DB-only with export?** (Recommendation above: files canonical. Confirm.)
4. **Do you want the review/SRS system, or is that scope creep for v1?** My view: it's what makes skill scores real, but it's also the single biggest sub-system here.
5. **Podcasts and articles — realistically manual, or is an integration a v1 requirement?** Manual podcast logging is exactly the kind of thing that gets abandoned.
6. **How do skill scores start?** Cold-start self-assessment, or forced baseline assessment before a skill can be tracked?
7. **Do goals ever fail?** Is there an explicit "missed / abandoned" outcome with a retro, or do they just slide forever? (Strong yes from me — abandoned goals are data.)

---

## 10. Suggested phasing

Deliberately narrow. Each phase must be independently useful — if you stop after any one of them, you still have something worth using.

### v0 — "Does this survive contact with reality?" (the smallest true loop)
Auth · Missions · Skills (manual score) · Resources with progress · Focus timer with intention + debrief · Friction logging · Basic weekly plan vs. actual · One dashboard.
**Proves:** will you actually log anything? Everything downstream depends on the answer.

### v1 — "The engine"
`teach` integration (workspace sync, lesson generation, lesson/reference library, learning records) · Study plans · Review queue (SRS) · AI assessments with confidence rating · Evidence-based skill scores with decay · The insights suite · Weekly review ritual.
**Proves:** does the loop produce real, measurable learning?

### v2 — "Reduce the friction it measures"
Integrations (Readwise, calendar, podcasts, GitHub) · Browser extension capture · AI weekly digest · Teach-back grading · Mobile/PWA polish · Automatic time capture.

### v3+ — optional
Multi-user, sharing a study plan, mentor/coach view, public artifact portfolio.

---

## 11. Glossary

- **Zone of Proximal Development (ZPD)** — the difficulty band where a task is hard enough to teach you and easy enough to complete. Lessons should land here.
- **Storage strength** — durability of long-term retention. The real goal.
- **Fluency strength** — how easily something comes to mind right now. Feels like mastery; often isn't.
- **Desirable difficulty** — effort that feels bad and helps: retrieval practice, spacing, interleaving.
- **Cognitive friction** — resistance encountered while learning or working. Split into *productive* and *wasteful* (§2).
- **Calibration gap** — the difference between how much you think you know and what you can demonstrate.
- **Skill decay** — loss of demonstrated ability over time without retrieval.
- **Learning debt** — accumulated queued-but-unconsumed material, and started-but-abandoned material.
- **Artifact** — real-world evidence of skill (shipped code, a talk, a post).
- **Teach-back** — explaining a concept as an assessment of understanding (Feynman technique).
