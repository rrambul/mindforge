# CURRICULUM.md Format

```markdown
# Curriculum

## Subject

<the subject being mastered, in one line>

## Tracks

| Order | Slug           | Track              | Outcome                                           | Prerequisites |
| ----- | -------------- | ------------------ | ------------------------------------------------- | ------------- |
| 1     | iam-basics     | IAM fundamentals   | Read a policy and say who it lets do what         | —             |
| 2     | vpc-networking | VPC networking     | Draw your own VPC and explain each hop            | —             |
| 3     | iam-authoring  | Writing IAM policy | Write a least-privilege policy for a real service | iam-basics    |

## Module: iam-basics

| Slug              | Lesson                  | Intent                                               | Difficulty | Depth    | Depends on        |
| ----------------- | ----------------------- | ---------------------------------------------------- | ---------- | -------- | ----------------- |
| policy-anatomy    | Anatomy of a policy     | Name every element of a policy statement out loud    | 1          | overview | —                 |
| policy-evaluation | How a request is judged | Walk a request through allow, deny and boundaries    | 3          | working  | policy-anatomy    |
| policy-reading    | Reading a real policy   | Say what a policy from your account actually permits | 2          | working  | policy-evaluation |

## Module: iam-authoring

| Slug            | Lesson                    | Intent                                            | Difficulty | Depth     | Depends on      |
| --------------- | ------------------------- | ------------------------------------------------- | ---------- | --------- | --------------- |
| least-privilege | Writing least privilege   | Write a policy that grants exactly what is needed | 3          | working   | policy-reading  |
| condition-keys  | Conditions and their keys | Constrain a policy by tag, source and time        | 4          | deep dive | least-privilege |

## Sources

- <title> — <url> — <why it is trusted>

## History

- YYYY-MM-DD: <curriculum created / revised, and why>
```

## Rules

- **`Slug` is stable and permanent.** Written lessons point at it. Rename the track freely; never
  change the slug of a track that already has lessons.
- **`Order` is a reading recommendation. `Prerequisites` is the structure.** A track with no
  prerequisites is a fundamental and takes `—`.
- **`Outcome` says what the user can do afterwards**, in one line, observably. Not what the track
  "covers".
- **No scores, bands, levels, percentages, or time estimates anywhere in this file.** A guess
  formatted as a number reads as a measurement. `Difficulty` is the one exception and it is defined
  below — it is a claim about the lesson, not about the user.
- Eight to fifteen tracks. If the subject needs more, the mission is too wide.

## The module tables

Every track gets a `## Module: <track slug>` section listing the lessons you plan for it, before any
of them exists. The heading names the **slug**, not the track name, because the name is free to
change and the slug is not.

The plan is what makes progress mean anything: a module with three lessons finished out of nine is a
fact, and without a planned list there is no denominator to be honest about. It is a plan, not a
promise — lessons get added, dropped and re-ordered as the user actually learns, and that revision is
expected.

| Column       | What it holds                                                                      |
| ------------ | ---------------------------------------------------------------------------------- |
| `Slug`       | Stable identity, unique across the whole curriculum. The lesson file will claim it |
| `Lesson`     | The title, as the user will read it                                                |
| `Intent`     | One line: what this lesson is for. Not a summary of its contents                   |
| `Difficulty` | 1–5 — how hard this lesson is **for this user**, at the level the mission records  |
| `Depth`      | `overview`, `working`, or `deep dive`                                              |
| `Depends on` | Lesson slugs that must be understood first, comma separated, or `—`                |

### Difficulty is relative to the user, not to the subject

A 1 is enterable today, given what `MISSION.md` records about their current level. A 5 is the hardest
thing in the curriculum for _them_. Two curricula on the same subject for two different people should
not have the same numbers, and if yours would, you have graded the subject instead of the plan.

Difficulty is not a score for the user and never appears as a percentage, a band, or a level. It is
how Mindforge orders the lessons inside a module once their prerequisites are met.

### Depth is how far down, not how long

- `overview` — enough to recognise the thing and know it exists
- `working` — enough to use it unsupervised on your own work
- `deep dive` — enough to reason about the parts other people treat as given

Most lessons are `working`. A module that is all `deep dive` is a module nobody finishes.

### Depends on

Names other **lesson** slugs, never track slugs. A lesson may depend on lessons in its own module and
on lessons in **earlier** modules — earlier by the track table's prerequisite structure. It may never
depend on a lesson in a later module: that would lock a module behind one that comes after it, and
Mindforge drops such an edge rather than believing it.

Two readings of the same edge, both of which Mindforge derives and neither of which you write:

- Forwards, it **locks**: a lesson is unblocked when every lesson it depends on is finished.
- Backwards, it makes a lesson **fundamental**: the more lessons depend on it, the more fundamental
  it is.

So never label a lesson "fundamental", "core", or "essential" in its title or intent. State the
dependency and the label follows from it.

### How many lessons

Three to eight per module. Fewer than three usually means the track is really a lesson in another
module; more than eight usually means it is two tracks. Plan every track's module — a track with no
lesson table has no honest progress, and the app will say so rather than show a zero.

## What lives elsewhere

Lesson **content** is not here. Lessons are generated one at a time as the user works through a
module, and each generated lesson claims its plan entry with
`<meta name="mindforge:lesson" content="<lesson slug>">` and declares its module with
`<meta name="mindforge:track" content="<track slug>">`. This file is an index of intent; the lessons
are the record of what happened. When the two disagree, the lessons are right.
