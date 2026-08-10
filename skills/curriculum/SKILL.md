---
name: curriculum
description: Map a subject into an ordered set of subtopics, fundamentals first, each with its lessons planned, within this workspace.
disable-model-invocation: true
argument-hint: "What subject do you want to master?"
---

The user wants to master a subject — AWS, Rust, tonal harmony — and needs to know what it is made of
and in what order to meet it. Your job is to produce that map, once, and revise it later as their
learning changes it.

You are **not** teaching here. You write no lesson content. `teach` does that, one lesson at a time,
when the user starts a track. Producing structure and producing material are separate jobs because
the structure has to be revisable without throwing away the material.

## What you produce

One file: `CURRICULUM.md`, in the format in [CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md).

It has two levels, and both are yours:

- **Tracks** — subtopics, each with a slug, a one-line outcome, and its prerequisite tracks. Ordered
  so that a track with no prerequisites comes first and the advanced ones come last.
- **A module table per track** — the lessons you plan for it: slug, title, one-line intent,
  difficulty, depth, and which lessons must come first. Titles and intents only; no lesson bodies.

## Ground it, or don't write it

**Read `MISSION.md` first.** A curriculum for "pass the SAA-C03 exam" and one for "stop being
frightened of our VPC" share perhaps a third of their tracks. Without the mission you will write the
generic syllabus that is on every blog, which is worse than nothing because it looks right. If
`MISSION.md` is missing or thin, ask the user why they want this before writing anything.

**Never trust your parametric knowledge.** Research the subject from real sources and record them in
`RESOURCES.md` as you go, exactly as `teach` does. A subject's shape changes; yours is a snapshot of a
training cut-off. Cite what you found. If `RESOURCES.md` is already populated, read it first — the
user's own trusted sources outrank anything you find.

**Read `learning-records/` if any exist.** A revision that ignores what they already learned proposes
tracks they finished.

## Eight to fifteen tracks. Not sixty.

An exhaustive syllabus is the failure mode, and it fails three ways: it is a guilt backlog on day one,
its later half is written before the user knows enough for it to be right, and it is exactly the
consumption metric this system exists to refuse.

Propose the tracks that get the user to the mission's `Success Looks Like`. When they finish those,
you will know far more about them than you do now, and can propose the next set. If the subject
genuinely cannot be usefully entered in fifteen tracks, say so and propose a narrower mission.

## Ordering

Order by **prerequisite**, not by convention. The order a subject is traditionally taught in is often
the order it was historically discovered in, which is rarely the order it is best learned in.

State a track's prerequisites explicitly, by slug. The linear `Order` column is a reading
recommendation; the prerequisite edges are the real structure, and Mindforge sequences from those plus
what the user has actually proved. Where the two disagree, the disagreement is information.

A track with no prerequisites is a fundamental. There should be more than one, and they should be
genuinely enterable by someone at the mission's `Current Level`.

## Outcomes, not inventories

A track's `Outcome` line says what the user can **do** afterwards, observably — "write an IAM policy
that grants least privilege", not "understand IAM". If you cannot imagine watching someone do it, it
is a topic description, not an outcome; sharpen it.

**Never assign a score, a band, or a level to a person.** Not to the user, not to a track as a claim
about them. The one number you write is a lesson's `Difficulty`, and it grades the lesson against
what `MISSION.md` says the user can already do — never the user against the subject.

## Plan every module's lessons

For each track, write its `## Module: <slug>` table: three to eight lessons, each with a stable slug,
a title, a one-line intent, a difficulty of 1–5, a depth, and its prerequisite lessons. The full
column rules are in [CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md).

This is the part that is easy to do badly, in three ways:

- **A lesson list is not a table of contents.** "Introduction to X", "X part 2", "Advanced X" is the
  subject's chapter list with the thinking left out. Each lesson's intent has to name something the
  user could not do before it and can after.
- **Dependencies are what you actually know about the subject.** The order you would teach it in is
  a guess; "you cannot understand this until you have that" is knowledge. Write the edges even when
  they contradict your own ordering — Mindforge sequences from the edges, and the disagreement is
  information.
- **A lesson depends on lessons, never on tracks.** Track prerequisites already handle the module
  level. An edge may reach back into an earlier module and never forward into a later one.

Plan every track's module, including the ones the user will reach last. If you genuinely cannot yet
say what a late track's lessons are — because they depend on what the earlier ones reveal — plan the
smallest honest list and say so in `NOTES.md`. A short module is revisable; an invented one is a plan
the user has to discover is wrong.

## Revising

Curricula go stale — the mission drifts, a track turns out to be three tracks, a fundamental turns out
to sit on something you missed. Rewrite `CURRICULUM.md` in place and add a learning record capturing
what changed and why, the same as a mission revision.

Three rules when revising:

- **Keep the slug of any track that still exists**, even if you rename it. The slug is what a written
  lesson points at, and changing it orphans a module.
- **Keep the slug of any lesson that still exists**, written or not. A written lesson claims its plan
  entry by slug; changing it detaches the lesson from the plan and the module's progress silently
  gains a lesson it has already finished.
- **Never quietly delete a track or a lesson the user has already worked through.** If it should go,
  say so and let them decide.

Re-planning a module is normal and expected. Say what moved in `## History`, and prefer revising a
lesson's title, intent and difficulty over dropping it and adding a near-identical replacement — the
second reads as churn in the progress numbers and the first does not.

## Confirm before writing

Show the user the proposed track list and its module tables, and let them cut, merge, reorder, and
rename before you write
the file. They know things about their own situation that neither the mission nor the sources record —
and a curriculum they edited is one they believe.
