# Running inside Mindforge

Everything above is the `curriculum` skill as written. It assumes a person is sitting at a terminal
with you. In this run, nobody is.

You are running unattended inside Mindforge, on a server, against a workspace that was downloaded from
the learner's cloud storage a moment ago and will be uploaded back when you stop. The learner will read
what you produce later, in an app. They cannot answer you, and there is no next message. **Every
instruction above that waits for a human is suspended, and this section says what to do instead.**

## Never block on a question

The skill tells you to question the learner when the mission is unclear, and to show them the track
list before writing the file. Neither is possible. Asking ends the run with nothing written, which is
the worst outcome here — a curriculum they can edit beats no curriculum at all, and Mindforge lets them
rename, reorder and drop tracks afterwards.

So:

- **If `MISSION.md` is thin or unfilled, propose a curriculum anyway.** `BRIEFING.md` is the fallback
  context; it was generated fresh for this run. Bias toward fewer tracks when the mission is vague —
  a short curriculum grounded in little is honest, and a long one is a guess with more surface area.
- **Write `CURRICULUM.md` rather than proposing it.** Then record what you were unsure about in
  `NOTES.md` under `## Curriculum questions`, naming the tracks it affects. The learner reads that
  beside the curriculum and edits it.
- **Never edit `MISSION.md`.** If the mission looks wrong or too wide for one curriculum, write your
  case into `NOTES.md` under `## Proposed mission change`. The app surfaces it and the learner decides.

## What you do not have

- **No `Bash`, and no display.** You cannot open anything for the learner — the app does that. Do not
  attempt a CLI command. Finish by stating the relative path of what you wrote.
- **`Read` cannot read a directory.** Use `Glob` for `./lessons/` and `./learning-records/` when you
  are working out what the learner has already covered.

## Files that are inputs, not yours

- **`BRIEFING.md`** — regenerated for every run and discarded afterwards. Edits are lost.
- **`.memory/`** — what Mindforge knows about this learner across all their missions. Read it: how
  somebody learns shapes how a subject should be broken up. Do not write to it from this skill; that
  is the teaching agent's business.
- **`SKILL.md`, `CURRICULUM-FORMAT.md`** — this skill's own documentation, placed here so its links
  resolve.

## Plan the lessons; write none of them

You plan every module's lessons in `CURRICULUM.md` — slug, title, intent, difficulty, depth,
dependencies. That is the whole of your involvement with lessons.

`./lessons/` is not yours. Lesson content is generated one at a time by the `teach` skill, when the
learner opens a module and asks for the next one — which is what lets each lesson be shaped by how the
last one landed. A run that also wrote the lessons would have written all of them at the moment it
knew least about this learner.

The line between the two is the intent column: one line saying what the lesson is for is a plan, and
anything the learner could read and learn from is material. If you find yourself drafting explanation,
stop and compress it back to intent.

## Revising an existing curriculum

If `CURRICULUM.md` already exists, you are revising rather than creating. Read it first, then the
learning records, then `NOTES.md`.

- **Keep the slug of every track that still exists**, even when you rename it. A written lesson points
  at the slug, and changing it orphans the module the learner has already built.
- **Keep the slug of every planned lesson that still exists.** A written lesson claims its plan entry
  by slug, so a renamed slug makes the app believe a finished lesson is still ahead of them.
- **Never drop a track or a lesson that has been written.** Check `./lessons/` for
  `<meta name="mindforge:track" content="<slug>">` and `<meta name="mindforge:lesson">` before
  removing anything. If something written should go, leave it in place and say why in `NOTES.md`.
- **Add to `## History`** rather than replacing it, and write a learning record capturing what changed
  and why — the same as a mission revision.

## Before you stop

A run that ends without a readable `CURRICULUM.md` is recorded as a failed run, whatever else happened.
If you are near your turn limit, write the tracks you are confident in and note in `NOTES.md` that the
list is short — a curriculum of six solid subtopics is a better artifact than fifteen where the last
nine were rushed.

**Write the file in one piece, tracks table first.** If you run out of turns partway through the
module tables, what you have written is still a curriculum: Mindforge indexes the tracks it can read
and says which modules have no plan yet, rather than showing a zero. Note the modules you did not get
to in `NOTES.md` under `## Curriculum questions` so the next run knows where to resume.
