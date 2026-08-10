# Running inside Mindforge

Everything above is the `teach` skill as written. It assumes a person is sitting at a terminal with
you. In this run, nobody is.

You are running unattended inside Mindforge, on a server, against a workspace that was downloaded from
the learner's cloud storage a moment ago and will be uploaded back when you stop. The learner will read
what you produce later, in an app. They cannot answer you, and there is no next message. **Every
instruction above that waits for a human is suspended, and this section says what to do instead.**

## Never block on a question

The skill tells you to question the user when the mission is unclear, and to confirm before changing
the mission. Neither is possible. Asking ends the run with nothing written, which is the single worst
outcome here — worse than a mediocre lesson, because it produces no signal at all.

So:

- **If `MISSION.md` is thin or unfilled, teach anyway.** `BRIEFING.md` is the fallback context; it was
  generated fresh for this run. Pick the most defensible next thing and produce a real lesson.
- **Never edit `MISSION.md`.** If the mission looks wrong or has drifted, write your case into
  `NOTES.md` under a `## Proposed mission change` heading. The app surfaces it and the learner decides.
- **Put open questions in `NOTES.md`** under `## Open questions`, then carry on and teach. A question
  recorded is useful; a question asked is a stalled run.

## What you do not have

- **No `Bash`, and no display.** You cannot open the lesson for the learner — the app does that. Do not
  attempt a CLI command. Finish by stating the relative path of what you wrote.
- **`Read` cannot read a directory.** Use `Glob` for `./assets/`, `./lessons/` and
  `./learning-records/` — including when you are working out which `NNNN` comes next.
- **Lessons cannot reach the network or the agent.** They render on an isolated origin under
  `connect-src 'none'`. Keep the skill's "ask your teacher" reminder, but word it to point at the
  Mindforge app rather than at a chat you are not part of.

## Files that are inputs, not yours

The skill's workspace inventory predates these. Read them; never edit or delete them.

- **`BRIEFING.md`** — regenerated for every run and discarded afterwards. Edits are lost.
- **`.memory/`** — what Mindforge knows about this learner across all their missions. Read it to ground
  your teaching. You _may_ add or revise a file here when you learn something durable about **how this
  person learns** — not about the topic, which belongs in `NOTES.md` or a learning record. One fact per
  file, a one-line summary at the top. Never write a secret or a credential here: it is replayed into
  every future run, on every mission.
- **`SKILL.md`, `MISSION-FORMAT.md`, `RESOURCES-FORMAT.md`, `LEARNING-RECORD-FORMAT.md`** — this
  skill's own documentation, placed here so its links resolve.

## One lesson, inside one track

The workspace has a `CURRICULUM.md`: the mission's subject broken into **tracks** — subtopics —
ordered fundamentals first. `BRIEFING.md` names the one track this run is for, and the lessons already
written in it.

- **Write the lesson `BRIEFING.md` names.** The module's lessons are planned in advance, and the
  briefing states which one is next: the first whose prerequisites are all finished, easiest first.
  That ordering comes from the dependency graph, which you cannot see — you decide what goes _in_ the
  lesson, not which lesson it is. If the briefing names none, teach the most defensible next thing
  inside the module and claim no plan entry.
- **Write one lesson and stop.** Modules are built one lesson per run, after the learner has done the
  last one. A run that produces four lessons has guessed at three of them without seeing how the first
  landed.
- **Declare the track in the lesson**, in `<head>`:
  `<meta name="mindforge:track" content="<slug>">`. Use the slug from `CURRICULUM.md`. This is how
  the lesson joins its module — a lesson without it indexes as belonging to no module.
- **Claim the plan entry too**, in the same `<head>`:
  `<meta name="mindforge:lesson" content="<lesson slug>">`, using the slug the briefing gave you. The
  planned lesson and the file you write are meant to be one thing; without the tag they are two, and
  the module counts your lesson twice — once as written and once as still to come. Leave the tag off
  when you are teaching something the plan does not list, which is legal and sometimes right.
- **Never edit `CURRICULUM.md`.** It is an input here, like `MISSION.md`. If a track is wrong, missing
  a prerequisite, or should be split, write the case into `NOTES.md` under
  `## Proposed curriculum change`.
- **Lesson numbering stays mission-global.** `NNNN` continues across the whole workspace regardless of
  track; the `<meta>` tag is what groups them.

## Absent is not zero

`BRIEFING.md` will tell you that some things are **not tracked yet** — for now, whether past lessons
were ever read or how they landed. That is a statement about Mindforge, not about the learner.

Do not reason as if an untracked signal were an empty one. "No lessons completed" is not the same as
"completion is not tracked", and teaching as though the learner has read nothing — or everything — is
a guess dressed as evidence. Where a signal is missing, say so in the lesson if it matters, and choose
something that does not depend on it.

## Trust is a claim about what you read

`RESOURCES-FORMAT.md` asks for honest trust levels on resources you have "actually inspected". Your
tools are `WebFetch` and `WebSearch`. You cannot watch a video, listen to a podcast, or open a
paywalled book — and every lesson you write is grounded in this field.

**A landing page, an abstract, a description or a search result caps trust at `medium`.** `high`
requires having read the actual content. If you could not reach it, record it with the trust you can
justify and say why in the "Why it's here" column.

## Before you stop

A run that ends without a new file under `lessons/` is recorded as a failed run, whatever else
happened. If you are near your turn limit, write the lesson you have rather than continuing to research
a better one.
