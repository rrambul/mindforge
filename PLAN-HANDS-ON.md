# Plan — hands-on lessons (Mindforge v2)

**Status, 2026-09-24:** Phases 0–5 are **built** — Python, not compiled languages; see Phase 5. Phase 4's requirements are FR-X7–X9 in
`REQUIREMENTS.md` §6.4b. Phase 3's requirements are FR-D1–D4 in
`REQUIREMENTS.md` §6.4d, Phase 2's are FR-H1–H4 in §6.4c, Phase 1's are FR-X1–X6 in §6.4b; the runner's security design is in `TECH-DESIGN.md` §7.5 and the lesson
shape in §7.3a. Phases 2–5 are still a plan. As each phase lands, its detail moves into those docs
and this file shrinks to what is still open.

**A code review on 2026-09-24 found ten issues across Phases 1–5; all are fixed.** The ones that
changed a design: reviews parse their own structured output and have their own client (§8.7);
opening a reference solution is recorded as the top rung of help (§8.6b); a bridge run's briefing no
longer also tells it to write the next planned lesson; the runner is split into `/runner`
(`connect-src 'none'`) and `/runner/python` (`connect-src 'self'`), so only Python carries the
relaxation; run failures are keys the app translates, not English from the runner.

**What changed from the plan while building Phase 1:**

- **No `exercises` table.** The declarations live on the lesson's own row as `lessons.exercises`
  (jsonb, CHECKed to an array), rewritten by every reindex. A separate index table would have been
  rebuilt — and its ids changed — on every sync, taking the attempts' foreign key with it.
  `exercise_attempts` is keyed by `(lesson_id, exercise_key)` instead.
- **The key is in the JSON**, not a `data-key` attribute, so the declaration is one self-contained
  object the schema can validate.
- **The runner executes code in a Blob Worker**, not on the frame's main thread. On localhost the app
  and lessons origins are same-site, so the frame can share the app's process, and an infinite loop
  on its main thread would freeze the app tab. `terminate()` is the only reliable timeout.
- **The runner route has its own CSP** (`'unsafe-eval'`, `worker-src blob:`), and lesson routes keep
  theirs unchanged. A test asserts the lesson CSP still has neither.
- **The results are the browser's**, and the row says so; the server derives `passed` from them so
  the rule has one home, and the database CHECKs that a pass means every test passed.

## The problem

The lessons are mostly text. The upstream `teach` skill already says a lesson should be "short" and
built around "an interactive feedback loop", but in practice the lessons are long explanations with a
quiz at the end. That makes the learning passive. And the only difficulty signal the app gets back is
three self-reported chips, which is too weak to adapt on.

## The goal

A lesson is **a small amount of explanation in service of an exercise you actually do**: writing code
that must pass tests, or sketching a design on a whiteboard. The app watches how the exercise went and
uses it to keep you in the zone: easier when you are stuck, harder when you are cruising. When you are
stuck mid-exercise you can ask the AI for help, and it gives you a hint, not the answer.

This is an evolution of the current app, not a rewrite. The curriculum pipeline, the reader, the
trackers, cost tracking and the progress fractions all stay. What changes is the lesson format and one
new feedback loop.

## Decisions taken

1. **This does not wait for the M6 soak** (decided 2026-09-24). Phases run in order starting now.
   `NORTHSTAR.md` sequencing rule 5 needs amending to match when this plan is folded in.
2. **Exercises are practice, not assessments.** Nothing here scores you or measures "do I know this".
   An exercise result is a signal about the _lesson's_ difficulty, which is what keeps this on the right
   side of the §5 cut ("AI assessments & calibration" stays cut).
3. **Which languages first.** Proposal: JS/TS, then Python. Rust (the seeded Rust mission) needs a
   server-side runner or a local-terminal exercise kind; see Phase 5.

## Principles this has to keep

| Existing rule                                  | What it means for this plan                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lesson HTML is untrusted (non-negotiable 7)    | The editor, runner and hint chat are **the app's**, not the lesson's. The sandbox is never relaxed to make an editor work.    |
| Files are canonical (non-negotiable 5)         | Exercises are declared in the workspace. `/teach-me` in a terminal must still produce and present them.                       |
| Honesty over encouragement (non-negotiable 10) | Adaptation is always visible, with its reason. No silent rewrites. A test pass and a self-report are different kinds of data. |
| Core owns domain math (non-negotiable 3)       | The "was this too hard / too easy" derivation lives in `packages/core`, once.                                                 |
| Unknown is never zero                          | A lesson with no exercise attempt has no difficulty signal (null with a reason), not "in the zone".                           |
| Cost tracking on every call (non-negotiable 9) | Every hint is an `llm_calls` row and counts against `TEACH_DAILY_BUDGET_USD`.                                                 |

## Reserved requirement IDs

- **FR-X** — exercises (declaration, rendering, running, attempts)
- **FR-H** — hints (AI help inside an exercise)
- **FR-D** — difficulty adaptation

---

## Phase 0 — Less text, by prompt only — built 2026-09-24

**Goal:** find out whether the format is right before building anything. Cheap: three
lesson runs and your judgement.

**Change:** a new `skills/LESSON-SHAPE.md`, appended after `UNATTENDED.md` in the teach plugin, and read
by `/teach-me` too, so both routes teach the same way. Built 2026-09-24.

- **Lesson shape:** hook (one paragraph, tied to the mission) → the minimum concept → one worked
  example → **the exercise** → debrief (what you just did, and why it matters).
- **Prose budget:** under 800 words of explanation. Code, the exercise and the debrief do not count;
  they are marked with `<section data-mindforge="exercise">` and `data-mindforge="debrief"`.
- **Every lesson has something you do.** A quiz alone is not enough.
- **A lesson cannot run code the learner types.** The lessons origin's CSP has no `'unsafe-eval'`, so
  `eval` and `new Function` are blocked in the frame. Phase 0 exercises are the kinds that can be
  checked without running code (predict the output, fill the blank, order the lines, find the bug), or
  "write it locally" with the tests and the command given in full. Phase 1 fixes this properly.

**Measure, don't eyeball.** Add a prose-word count to `packages/workspace/src/parse/html.ts` (text
outside `pre`, `code`, `script` and the exercise block) and emit a run warning over budget, the same way
the parser already warns about a missing stylesheet. That gives a number to compare old and new lessons
by, instead of an impression.

**Done when:** three lessons generated on a real mission read as mostly-doing, and the word count
confirms it. If they don't, iterate on the addendum before starting Phase 1.

---

## Phase 1 — Exercises owned by the app (FR-X1–X6) — built 2026-09-24

### The exercise contract

A lesson declares its exercises as data, inside the lesson file:

```html
<script type="application/vnd.mindforge.exercise+json" data-key="retry-backoff">
  {
    "kind": "code",
    "language": "typescript",
    "title": "Write a retry with exponential backoff",
    "prompt": "…markdown…",
    "starter": "export function retry(...) {\n}\n",
    "tests": "import { retry } from './solution';\n…",
    "solution": "…reference solution, used to ground hints…",
    "expectedMinutes": 10
  }
</script>
```

- **Why in the lesson file and not a sibling file:** the file owns what a lesson is, and one file per
  lesson keeps the terminal route simple. A non-JS `type` means the browser never executes the block.
- **Schema in `packages/core`** (Zod), shared by the parser, the API and the SPA. The parser rejects
  nothing: a malformed exercise is a run warning and the lesson still indexes, as today.
- **The reference solution is visible to anyone who opens the lesson source.** It's your own workspace
  and self-study, so that is acceptable; the UI never shows it unless you ask.
- `kind` is one of `code`, `whiteboard` (Phase 4), `task` (a checklist you do outside the app and tick,
  recorded as self-reported).

### Storage

- **`exercises`** — an index row per declared exercise (`lesson_id`, `key`, `kind`, `language`,
  `content_hash`). Rebuildable from files, like `lessons`. Written by the reindexer.
- **`exercise_attempts`** — learner data the reader owns, like `completed_at` and `outcome`:
  `exercise_id`, `code`, `passed`, `tests_passed`, `tests_total`, `hint_level_max`, `started_at`,
  `submitted_at`. One row per run of the tests.
- Both tables ship with RLS policies and RLS tests (non-negotiable 2). Migration written by hand, as
  always (`prisma migrate dev` cannot run here).
- **Open:** should the final submission also be written back to the workspace (`solutions/…`) so that a
  terminal `/teach` session can see your code? It's more "files are canonical", but it makes the app a
  second writer to the workspace. Decide before building.

### Rendering

- **Split view on the lesson route:** lesson frame on the left, exercise panel on the right at ≥1024px;
  two tabs ("Lesson" / "Exercise") below that. Test at 375px.
- **Editor:** CodeMirror 6 (smaller than Monaco and usable on a phone), lazy-loaded on the lesson route
  only. Unsent drafts are kept per exercise in `localStorage`, wrapped in try/catch.
- New components go in `apps/web/src/shared/ui`; the feature is `features/exercise`. The lesson route
  composes it; `features/lesson` does not import it (features never import each other).
- en + pt-BR strings for everything.

### Running the tests

The learner's code is theirs, but **the tests are agent-written and untrusted**, so they never run in the
app's origin.

- A **runner page served by `apps/lessons`**, loaded in its own `sandbox="allow-scripts"` frame (still
  no `allow-same-origin`). The runner is app-owned code; the exercise's code and tests are the data
  it receives.
- **The runner route needs its own CSP, with `'unsafe-eval'`**, because running code is its job.
  Lesson routes keep theirs unchanged. It is still `connect-src 'none'` and still sandboxed, so code
  it runs can reach nothing.
- The app sends `{ code, tests, language }` via `postMessage`, the runner answers
  `{ results: [{ name, passed, message }] }`. This is the first real `postMessage` channel, so it gets
  what §7.5 promised: a strict `origin` check on both sides, a Zod schema on every payload, never `eval`
  of anything structural.
- **Timeout** by tearing the frame down (an infinite loop must not hang the tab).
- TS is transpiled in the runner (e.g. `sucrase`), tests use a tiny in-house `test`/`expect` rather than
  a real test framework in the browser.

### API

- `GET /v1/lessons/:id/exercises` and `POST /v1/lessons/:id/exercises/:key/attempts`, response shapes
  in `packages/core/src/schemas/wire.ts`.
- The attempt is recorded by the app from the runner's results. The client is trusted to report its own
  test results (it's single-user; you would only be lying to yourself), and the row says so.

### Tests

- Parser: exercise blocks extracted, malformed block → warning, lesson still indexed.
- Runner: pass, fail, throw, timeout, a message from the wrong origin is ignored.
- `LessonRoute.test.tsx` keeps its sandbox assertion, and gets a second one for the runner frame.
- `lesson.spec.ts`: open a seeded lesson with an exercise, fail it, fix it, pass it.
- `seed:rich` gets lessons with exercises and some attempts in each state.

**Done when:** you can open a lesson, write code in the panel, run the tests, see failures, fix them and
pass, and the attempt is on record.

---

## Phase 2 — Help when you're stuck (FR-H1–H4) — built 2026-09-24

**What changed from the plan while building it:**

- **Hints get their own table** (`exercise_hints`), not a `hint_level_max` column on attempts. A hint
  is usually asked for _between_ runs, so it belongs to no attempt; Phase 3 compares hint times
  against the first pass instead.
- **The server owns the ladder.** `nextHintLevel` is in the view and the API refuses a skipped rung,
  so the client never climbs on its own.
- **The key is explicit.** `ANTHROPIC_API_KEY` in the API's env, passed to the client, rather than
  the SDK's credential chain, which would also find a developer's `ant` profile and bill that.
- **SDK errors are classified in `packages/llm`** into "configuration" and "transient", and reach the
  learner as "not available" or "try again". The first live call — against a key with no credit —
  came back as a generic 500 before this existed.
- **Not yet verified live.** The one real call the plan asks for failed on billing (the local key
  has no credit), so latency and real cost per hint are still unmeasured. The error path is.

### The hint ladder

The same escalation `engineer-flow` uses, one rung per press:

1. **Question:** "What happens to the delay on the third retry?"
2. **Clue:** points at where the bug or gap is.
3. **Concept:** names and explains the idea you're missing.
4. **Structure:** the shape of the solution, in pseudocode.
5. **Code:** the relevant part of the solution, explained.

Plus a free-text box: "Ask about this exercise". The model gets the same ladder rule: no full solution
below rung 5.

### How a hint is made

- `POST /v1/lessons/:id/exercises/:key/hints` with `{ level, code, lastResults, question? }`.
- One Messages API call through `packages/llm` (`@anthropic-ai/sdk`, not the Agent SDK; this is not a
  teach run). The system prompt is frozen per purpose for caching; the exercise, reference solution, your
  code and the failing tests go after the last cache breakpoint.
- Writes an `llm_calls` row (`purpose: hint`) and is checked against the daily budget in the same
  place `TeachRuns.request` checks it. Over budget → the button says so; it never fails silently.
- **Model:** start with the default, measure latency. A hint that takes 30 seconds breaks flow; if it
  does, choose a faster model for this purpose in `TECH-DESIGN.md` §8.1.

### Honesty

- `hint_level_max` on the attempt. Passing with rung 5 and passing cold are different results, and the
  UI and the briefing say which.
- Tests use recorded fixtures (non-negotiable 8).

**Done when:** you can get unstuck on a real exercise without being handed the answer, and the spend
panel shows what the hints cost.

---

## Phase 3 — Staying in the zone (FR-D1–D4) — built 2026-09-24

**What changed from the plan while building it:**

- **Only finished lessons are judged.** A learner three failing runs into an exercise is working, not
  failing; "too hard" at that moment would be wrong and discouraging. The verdict is drawn when an
  outcome is recorded, which is also when the next run reads it.
- **"Too easy" needs a clock.** A first-try pass with no recorded start could have taken an hour, so
  it is "in the zone", not "too easy" — a push on a guess would be the inflation non-negotiable 10
  forbids, in the other direction.
- **One bridge per lesson.** Until the bridge is finished, the too-hard lesson is still the newest
  judged one; without the rule every press would order another step toward it.
- **The target travels in `agent_runs.input`** (`bridgeFor`), not a new column, and not a new run
  kind: a bridge is a lesson run with a different instruction in its briefing.
- **Bridges are linked by slug**, like plan claims (`resolveBridges`), and the earliest written lesson
  with that slug wins.
- **Found, not fixed:** a curriculum whose tracks are all `proposed` has no open module, so its lesson
  runs write off-plan lessons that appear in no module (the Node.js mission today). Pre-existing, and
  it hides Phase 3's verdicts for those lessons from the curriculum screen.

### The signal

A pure function in `packages/core`, `lessonStrain(lesson, attempts, outcome)`, returning
`too-hard | in-zone | too-easy`, or null with a reason ("no attempt", "no exercise"). First rules,
deliberately simple and written down so they can be argued with:

- **too-hard:** outcome `lost`, or never passed, or passed only at hint rung ≥ 4.
- **too-easy:** passed on the first attempt, no hints, in well under `expectedMinutes`, and outcome
  `understood`.
- **in-zone:** everything else.

The outcome chips stay, and are never prefilled from the exercise result. Self-report and measurement are
shown side by side, not blended.

### What the app does with it

- **Too hard → a bridge lesson, never a rewrite.** The lesson you struggled with stays as it is. The next
  run writes a smaller step before it (same concept, lower difficulty) that declares
  `<meta name="mindforge:bridge-for" content="<slug>">`, and the original is suggested again afterwards.
  The module gains a lesson, so its fraction moves, and the curriculum screen says why. This is the
  honest form of "make the lesson easier": nothing you did disappears.
- **"Try an easier version" button** on a lesson you marked `lost` or couldn't pass, so you don't have to
  wait for the next press. It queues a `generate_lesson` run targeted at that bridge.
- **Too easy → the next lesson is pushed.** The briefing tells the run to go one step above the planned
  difficulty, and the lesson records `<meta name="mindforge:adjusted" content="harder: …">`.
- **Always visible.** The next-lesson panel says what changed and why: "Harder than planned: you passed
  the last two first try with no hints."

### Briefing

A new `BRIEFING.md` section with the last few lessons' strain and the evidence behind it (attempts, hint
rung, minutes). Absent data renders as absent (§7.3b), not as "in the zone".

**Open:** a lesson run is forbidden to write `CURRICULUM.md`. Bridge lessons and difficulty changes
therefore live in the lesson files, not the plan. Check whether that's enough, or whether a curriculum
regeneration should absorb them afterwards.

**Done when:** a week of real use shows at least one bridge and one push, and each one felt right.

---

## Phase 4 — Whiteboard exercises (FR-X7–X9) — built 2026-09-24

**What changed from the plan while building it:**

- **A review is an attempt**, not a new record type: its results are the rubric items, so the summary,
  the verdict and adaptation needed no second path. The row says `graded_by = 'review'` and carries the
  drawing (`scene`), the overall sentence (`feedback`) and the bill (`llm_call_id`).
- **The rubric is withheld by the server**, not hidden by the screen, until the first review.
- **The drawing is sent twice**: as a PNG, which is the evidence, and as `describeScene`'s text, because
  a model reading arrows off pixels misreads which end is which — and a design review is mostly that.
- **Structured output, strictly aligned**: one verdict per rubric index or the review is `empty` (billed,
  not shown).
- **No hint ladder for whiteboards yet.** The review is the feedback; hints stay code-only.
- **The API's body limit is 6 MiB**, global because Nest has no per-route limit; each field is capped by
  its schema.
- **Not verified live**, for the same reason as hints: the local key has no credit.

For system design and anything better drawn than written.

- `kind: "whiteboard"` with a prompt and a **rubric** (the things a good answer covers: "has a queue
  between A and B", "handles the hot partition").
- Excalidraw, lazy-loaded in the exercise panel. The drawing is saved as its JSON scene on the attempt.
- **Grading is AI review against the rubric**: the scene (as structured elements plus a rendered PNG) and
  the rubric go to the model, which answers per rubric item: covered / partly / missing, with one line
  each. It's feedback, not a score, and costs an `llm_calls` row like a hint.
- The same hint ladder applies.

**Done when:** a system-design lesson on the distributed-systems mission can be done entirely by drawing.

---

## Phase 5 — More languages — Python built 2026-09-24

**What changed from the plan while building it:**

- **Pyodide 314.0.7, self-hosted** at `/pyodide/<version>/…` on the lessons origin, from an allowlist of
  five files, cached immutable. Standard library only; anything else would come from Pyodide's CDN,
  which the runner's CSP refuses.
- **The runner's CSP changed**, on the runner route only: `'wasm-unsafe-eval'` to compile the
  interpreter, and `connect-src 'self'` (was `'none'`) so it can fetch its own files. A run can now reach
  this origin and nothing else — and this origin serves nothing a run could use without a grant the
  runner frame never holds. Lesson routes keep `connect-src 'none'`, pinned by a test.
- **CORS on Pyodide's files** (`Access-Control-Allow-Origin: *`): the sandboxed frame's origin is opaque,
  so Pyodide's own `fetch` is cross-origin. Public distribution files; nothing else carries the header.
- **A warm worker**, unlike JavaScript's one-per-run: Python starts once (seconds) and stays up; a run's
  5-second clock starts after it is ready, and a timeout kills the worker so the next run starts fresh.
  The harness builds a fresh `solution` module per run, tested in one interpreter.
- **The app warms Python** as soon as the runner is listening, and waits out the start on the first run.
- **Compiled languages run on the learner's machine**, as the `task` kind (FR-X10, built the same day):
  files, command, and a self-reported result, recorded as such. A server-side runner — real in-app
  Elixir, Rust, Go — is still unbuilt, and would be real infrastructure.
- The first Python run in the E2E suite took about two seconds on a warm dev machine.

- **Python:** Pyodide in the runner, self-hosted on the lessons origin (CSP stays `'self'`). It's about
  10 MB, so load it only when an exercise needs it.
- **Rust, Go, anything compiled:** two options, decide when it's needed:
  - `kind: "task"` with a local command (`cargo test`), and you report the result. Recorded as
    self-reported, never as a pass.
  - A server-side runner. Real infrastructure (isolation, quotas), and not provisioned anywhere today.

---

## Order and what sets the pace

The whole plan fits in half a day. Writing the code is not what takes the time. These are:

| Phase | What                              | What takes the time                                                     | Depends on  |
| ----- | --------------------------------- | ----------------------------------------------------------------------- | ----------- |
| 0     | Less text (prompt + word count)   | Real lesson runs (~8 min, ~$1.50 each) and you reading them             | nothing     |
| 1     | Exercise contract, editor, runner | Hand-written migration + RLS tests, E2E against the four processes      | 0           |
| 2     | Hint ladder                       | Recording fixtures; one real hint to measure latency and cost           | 1           |
| 3     | Difficulty adaptation             | A lesson run with the new briefing section, to see a bridge get written | 1 (2 helps) |
| 4     | Whiteboard                        | Excalidraw bundle size on the lesson route; one real review call        | 1, 2        |
| 5     | Python                            | Self-hosting Pyodide (~10 MB) on the lessons origin                     | 1           |

Compiled languages (Rust, Go) stay out of the half day: a server-side runner is infrastructure nobody
has provisioned. The `task` kind covers them meanwhile.

**Phase 0's check still comes first.** If three lessons in the new format don't feel better, Phases
1–5 are building on the wrong format. That review takes about 30 minutes of your time and is the one
step nothing can speed up.

## Open questions

- Does the lesson frame still need to be `100dvh` when a lesson is a third of its current length, or does
  the split view make that moot? (Sizing the frame to its content would need a height message over
  `postMessage`; §7.5's rules would apply.)
- Should the final submission be written back to the workspace? (Phase 1.)
- Do bridge lessons belong in the plan after the fact? (Phase 3.)
- What does a hint cost in practice, and does the default budget still fit?
