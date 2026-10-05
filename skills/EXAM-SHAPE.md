# The shape of a Mindforge exam

This section is Mindforge's own. It applies to every exam, whether an unattended run writes it or a
person does through `/teach-me`. Where it is stricter than the `teach` skill or `LESSON-SHAPE.md`,
it wins. An exam is written by a run of its own: **a run that writes an exam writes no lesson, and a
lesson run never writes an exam.**

When `BRIEFING.md` says a run is for an exam, the lesson instructions before this section stop
applying: "write the lesson the briefing names", "claim the plan entry", and the five parts of a
lesson. Everything else still holds: no `Bash`, no questions, no learning records, never edit
`CURRICULUM.md` or `MISSION.md`, and a run that ends without a new file under `lessons/` has failed.

An exam ends a module. The learner has finished every lesson in it, and the exam is how they find
out whether the module actually landed. The understood / shaky / lost chips are the learner's own
opinion. The exam is a test.

## What it examines

**Only what this module's lessons taught.** `BRIEFING.md` lists every lesson in the module, how each
landed, and the exercises each had. Read the lesson files themselves before you write anything. An
item that needs an idea none of them taught is not hard, it is unfair. Before you write each item,
list what a good answer has to contain and check every part against the lessons. If a part comes
from somewhere else, give it to the learner in the prompt or cut it.

**Weight it toward what landed badly.** A lesson marked shaky or lost, or one whose exercise the
learner never passed, gets an item. A lesson that landed well can share one with its neighbours.

**Test the same ideas, never the same exercises.** An item that repeats a lesson's exercise with the
names changed tests memory of that exercise. Apply the idea to a new case, combine two lessons'
ideas, or ask for the thing the lessons built toward.

## How it is built

- **Four to eight items.** Each takes 5–15 minutes. The whole exam should fit in one sitting of an
  hour or less.
- **Each item is a declared exercise**, in exactly the format `LESSON-SHAPE.md` gives:
  `<script type="application/vnd.mindforge.exercise+json">`, with a unique `key`.
- **Prefer kinds that are checked.** `code` (JavaScript, TypeScript, Python) runs tests in the app,
  and `whiteboard` is reviewed against a rubric. Use `task` only for a language the browser cannot
  run, and `lab` only when the module was about operating a real platform and its lessons had labs.
  The app shows a task's or a lab's pass as self-reported.
- **Every item declares `covers`**, the slugs of the lessons it examines, from the briefing's list:

  ```json
  { "key": "borrow-across-calls", "kind": "code", "covers": ["borrowing", "moves"], "…": "…" }
  ```

  When an item is failed, the app names these lessons as the ones to revisit. An item without
  `covers` cannot point the learner anywhere.

- **No hints and no answers, anywhere.** The app refuses hints on an exam item until it is passed.
  **Leave `solution` out of every item.** The exam file is the page the learner is sitting in, and
  its source is one click away, so a solution in it is the answer key handed out with the paper.
  Mindforge drops any it finds and flags the run. Never put the answer in the page either.
- **Tests and rubrics are strict.** An exam test checks the behaviour the module taught, including
  the edge case the lessons named. A rubric line is something a good answer visibly covers, never a
  quality like "is well designed".

## The page

Very little prose. One short paragraph opens it: what the module covered, how many items there are,
that there are no hints, and that an item can be retried and every attempt is kept. Then the items,
each in its own `<section data-mindforge="exercise">`. No worked examples and no re-teaching: the
lessons are one click away. The prose budget still applies and an exam should be far under it.

## The tags

In `<head>`:

```html
<meta name="mindforge:kind" content="exam" />
<meta name="mindforge:track" content="<the module's slug>" />
```

**No `mindforge:lesson` tag.** An exam is not a plan entry, and claiming one would take a lesson
the module still owes out of the plan. **No `mindforge:adjusted` tag** either: an exam tests the
module as taught and adapts nothing.

Name the file like a lesson, with the next free number: `lessons/NNNN-exam-<module-slug>.html`. The
title is `Exam: <module name>`.

## Last: the humanizer

Run the `humanizer` skill over the opening paragraph and the item prompts, in file mode, under the
same rules `LESSON-SHAPE.md` gives. It must not touch the exercise JSON's `tests`, `starter`,
`rubric`, `covers` or `key`.

## What you do not write

No learning record: nothing has been learned yet, the learner has not sat it. No reference
documents. No changes to `CURRICULUM.md` or to any lesson.
