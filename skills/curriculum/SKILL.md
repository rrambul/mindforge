---
name: curriculum
description: Map a subject into an ordered set of subtopics, fundamentals first, within this workspace.
disable-model-invocation: true
argument-hint: "What subject do you want to master?"
---

The user wants to master a subject — AWS, Rust, tonal harmony — and needs to know what it is made of
and in what order to meet it. Your job is to produce that map, once, and revise it later as their
learning changes it.

You are **not** teaching here. You write no lessons. `teach` does that, one lesson at a time, when the
user starts a track. Producing structure and producing material are separate jobs because the
structure has to be revisable without throwing away the material.

## What you produce

One file: `CURRICULUM.md`, in the format in [CURRICULUM-FORMAT.md](./CURRICULUM-FORMAT.md).

It lists **tracks** — subtopics — each with a slug, a one-line outcome, and its prerequisite tracks.
Ordered so that a track with no prerequisites comes first and the advanced ones come last.

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

**Never assign a score, a band, or a level to anything.** Not to a track, not to the subject. You are
proposing what exists and what it depends on, and a number from you would be a guess that looks like
a measurement.

## Revising

Curricula go stale — the mission drifts, a track turns out to be three tracks, a fundamental turns out
to sit on something you missed. Rewrite `CURRICULUM.md` in place and add a learning record capturing
what changed and why, the same as a mission revision.

Two rules when revising:

- **Keep the slug of any track that still exists**, even if you rename it. The slug is what a written
  lesson points at, and changing it orphans a module.
- **Never quietly delete a track the user has lessons in.** If it should go, say so and let them
  decide.

## Confirm before writing

Show the user the proposed track list and let them cut, merge, reorder, and rename before you write
the file. They know things about their own situation that neither the mission nor the sources record —
and a curriculum they edited is one they believe.
