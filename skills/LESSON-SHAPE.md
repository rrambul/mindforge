# The shape of a Mindforge lesson

This section is Mindforge's own, and it applies to every lesson, however it is written: by an
unattended run, or by hand through `/teach-me`. Where it is stricter than the `teach` skill, it wins.

The `teach` skill already asks for lessons that are short, practical and built on a feedback loop. In practice
lessons have come out as long explanations with a quiz at the end. Reading about a thing is not doing
it, and the learner's working memory fills up long before a wall of prose is over. **A lesson is a
small amount of explanation in service of one thing the learner does.**

## Five parts, in this order

1. **Hook** — one short paragraph: the problem this lesson solves, tied to the mission. Why the learner
   should care right now.
2. **The minimum concept** — only what the exercise needs. If a paragraph would not change how the
   learner attempts the exercise, cut it or move it to a reference document.
3. **One worked example** — a concrete case, shown step by step. Code for a programming topic, a
   diagram for a design topic.
4. **The exercise** — the centre of the lesson. See below.
5. **Debrief** — what the learner just did, the one idea to keep, and where it shows up next. Two or
   three sentences.

Link the primary source and the reference documents as the `teach` skill asks. They carry the depth, so the
lesson does not have to.

## The prose budget

Explanation — the hook, the concept and the prose around the worked example — stays **under 800
words**, and should be well under. Code, diagrams, the exercise and the debrief do not count.

Mindforge measures this. Text outside `<pre>`, `<code>`, scripts, and the two sections marked below is
counted when the lesson is indexed, and a lesson over budget is flagged on its run. When you are near
the limit, cut theory rather than practice: a reference document is where the rest of the explanation
belongs.

## The exercise

Every lesson has one. It is something the learner **does**, not something they read and nod at:

- **Programming:** write, fix, complete or predict code.
- **System design:** sketch a design for a stated problem, then check it against a list of what a good
  answer covers.
- **Anything else:** a worked task with a concrete result the learner can check.

A multiple-choice quiz on its own is not an exercise. It can come after one, as a check.

**Feedback must be immediate, and ideally automatic.**

### Code exercises run in the app

For JavaScript, TypeScript and Python, **declare the exercise and Mindforge runs it**: the learner writes code
in an editor beside the lesson, presses "Run tests", and sees each test pass or fail. Declare it as
JSON inside the lesson, anywhere in `<body>`:

```html
<script type="application/vnd.mindforge.exercise+json">
  {
    "key": "retry-backoff",
    "kind": "code",
    "language": "typescript",
    "title": "Retry with exponential backoff",
    "prompt": "Write retry(fn, attempts) so that it calls fn until it succeeds…",
    "starter": "export function retry(fn: () => number, attempts: number): number {\n  // …\n}\n",
    "tests": "import { retry } from \"./solution\";\n\ntest(\"returns the first success\", () => {\n  expect(retry(() => 42, 3)).toBe(42);\n});\n",
    "solution": "export function retry(…) { … }\n",
    "expectedMinutes": 10
  }
</script>
```

- **`key`** is lowercase dash-case and unique within the lesson. Keep it stable if you ever revise the
  lesson: the learner's attempts are recorded against it.
- **`language`** is `javascript`, `typescript` or `python`. TypeScript is transpiled, never
  type-checked — the tests are the check. Python has its own test conventions, below.
- **`prompt`** is plain text: the task, the signature, the constraints. The lesson has already explained
  the idea.
- **`starter`** is what the editor opens with. It must export what the tests import.
- **`tests`** import the learner's code from `"./solution"` — nothing else can be imported — and use
  `test(name, fn)` (or `it`), `describe`, and `expect(value)` with `.toBe`, `.toEqual`, `.toBeTruthy`,
  `.toBeFalsy`, `.toBeNull`, `.toBeUndefined`, `.toBeDefined`, `.toContain`, `.toHaveLength`, `.toMatch`,
  `.toBeGreaterThan`, `.toBeLessThan` (and the `OrEqual` forms), `.toBeCloseTo`, `.toThrow`, `.not`,
  `.resolves` and `.rejects`. Tests may be `async`. The whole run stops after 5 seconds.
- **Write tests that teach.** Three to six, each named for the behaviour it checks, ordered from the
  simplest case to the edge case the lesson was about. A failing test's name is the learner's next hint.
- **`solution`** passes every test. It is hidden until the learner asks for it.
- **`expectedMinutes`** is your honest estimate for this learner.

Mention the exercise in the lesson's `data-mindforge="exercise"` section — a sentence saying what to
build and that the editor is beside the lesson — rather than repeating the prompt.

### Python exercises

`"language": "python"` runs on Pyodide in the browser — real CPython, **standard library only**: no
`pip`, no `numpy`, nothing that is not in the stdlib. The tests are plain Python:

- The learner's code is the module `solution`: `from solution import on_receive`.
- A test is a top-level function whose name starts with `test_`, run in the order defined. Name it for
  the behaviour — `test_a_message_from_the_past_still_ticks_the_clock` is shown to the learner as "a
  message from the past still ticks the clock".
- Fail with `assert`. A bare `assert on_receive(3, 7) == 8` fails showing that line; add a message
  (`assert x == y, "…"`) only when the line alone would not say what went wrong.
- `print` output is shown with the run. The whole run stops after 5 seconds, not counting the few
  seconds Python takes to start the first time.

### Other languages run on the learner's machine

For a language the browser cannot run — Elixir, Rust, Go, anything compiled — **declare a task**: the
lesson gives every file and the command, the learner runs it in their own terminal, and reports back.

```html
<script type="application/vnd.mindforge.exercise+json">
  {
    "key": "gen-counter",
    "kind": "task",
    "language": "elixir",
    "title": "A counter as a GenServer",
    "prompt": "Write Counter so that increment/1 and value/1 pass the tests…",
    "files": [
      { "path": "mix.exs", "contents": "…" },
      { "path": "lib/counter.ex", "contents": "defmodule Counter do\n  # …\nend\n" },
      {
        "path": "test/counter_test.exs",
        "contents": "defmodule CounterTest do\n  use ExUnit.Case\n  …\nend\n"
      }
    ],
    "command": "mix test",
    "solution": "…",
    "expectedMinutes": 15
  }
</script>
```

- **Every file, in full.** The learner creates exactly these, so the project must build and the tests
  must run from nothing else: include the build file (`mix.exs`, `Cargo.toml`, `go.mod`) and state in the
  prompt any tool they need installed. Paths are relative to the project root.
- **`command`** is the one command that runs the tests from that root.
- **The starter must fail the tests** and the solution must pass them. You cannot run them here, so
  read both against each test line by line before writing the lesson.
- The learner's result is **their report**, recorded and shown as self-reported — never as a pass the
  app checked.

### Design exercises are drawn and reviewed

For system design, **declare a whiteboard exercise**: the learner draws their design on a canvas beside
the lesson, submits it, and an AI reviewer reads the drawing against your rubric, item by item —
covered, partly, or missing, each with a one-line note.

```html
<script type="application/vnd.mindforge.exercise+json">
  {
    "key": "charge-once",
    "kind": "whiteboard",
    "title": "Charge exactly once",
    "prompt": "A checkout service calls a payment provider… Draw the services and the calls between them so that a customer is never charged twice.",
    "rubric": [
      "The client sends an idempotency key with every charge request, and reuses it on retry",
      "The payment side stores the key with the result, so a repeated key returns the first result",
      "Calls to the provider have a timeout and a bounded retry"
    ],
    "solution": "A reference design, in words…",
    "expectedMinutes": 20
  }
</script>
```

- **The rubric is the grading contract.** Two to ten items, each a concrete thing a good design
  _does_, checkable on its own from a drawing: "puts a queue between the API and the workers", not
  "is scalable". An item nobody could judge from boxes and arrows is an item the reviewer will guess
  at.
- **The learner does not see the rubric until their first review** — it is the answer. So the prompt
  must state the problem and its constraints fully; do not lean on the rubric to explain the task.
- **`solution`** is a reference design in words, shown only on request after a review.
- Hints are for code exercises; a whiteboard's feedback is its review.

### Everything else

For anything the runner cannot check — a design, another language, a real-world task — choose a form
the lesson itself can check without running the learner's code. Lessons run scripts but cannot use
`eval` or reach the network:

- **Predict the output** of a snippet, then reveal it and explain why.
- **Fill in the blank** in real code, checked against the accepted answers.
- **Put lines in order** (a Parsons problem) to make a working function.
- **Find the bug** — the learner picks the faulty line, and the lesson explains it.

Make the exercise a step harder than the worked example, not a copy of it with the names changed. It
should take about 5–15 minutes. Offer the reference solution behind a reveal, never in plain view.

## Mark the two sections

Wrap the exercise and the debrief so they can be told apart from the explanation:

```html
<section data-mindforge="exercise">…</section>
<section data-mindforge="debrief">…</section>
```

Without the markers, the exercise's text is counted as explanation and the lesson looks longer than
it is.

## Adapting to how the last lessons landed

Mindforge judges each finished lesson from what the learner did — attempts, hints, time — and the
outcome they recorded: **too hard**, **in the zone** or **too easy**. The rules live in Mindforge,
not here, and you do not re-derive them. `BRIEFING.md`'s "What this lesson should do" section says
which of three things this lesson is, with the exact tags to write:

- **A bridge.** The last lesson landed too hard, or the learner asked for an easier version. Write a
  smaller step toward it — the same idea, one gap closed, lower difficulty — instead of the next
  planned lesson. Never rewrite or replace the lesson it steps toward; end the bridge by sending the
  learner back to retry it. A bridge claims no plan entry.
- **A push.** Two lessons in a row landed too easy. Teach the next planned lesson one step above what
  the plan says: a harder exercise, fewer scaffolds, an edge case the plan left for later.
- **As planned.** Teach the next planned lesson as the plan describes it.

When you adapt, say so in the lesson's `<head>`, because the learner is shown it:

```html
<meta name="mindforge:adjusted" content="bridge" />
<!-- or "harder" -->
<meta name="mindforge:bridge-for" content="<slug of the lesson it steps toward>" />
<!-- bridges only -->
<meta
  name="mindforge:adjusted-reason"
  content="One plain sentence naming what the evidence showed."
/>
```

The reason is read by the learner on the curriculum screen. State the evidence plainly — "You passed
the last two exercises first try, well under the expected time" — with no praise and no apology.
