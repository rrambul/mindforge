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

## Skills

| Track          | Skill slug          | Skill                                               |
| -------------- | ------------------- | --------------------------------------------------- |
| iam-basics     | iam-read-policy     | Read an IAM policy and predict what it permits      |
| iam-basics     | iam-principal-model | Explain users, roles, and assume-role               |
| vpc-networking | vpc-subnet-routing  | Trace a packet through subnets and route tables     |
| iam-authoring  | iam-least-privilege | Write a least-privilege policy for a given workload |

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
- **Every skill belongs to exactly one track** in this table — the one that builds it. Other tracks
  may use it; only one teaches it.
- **A skill is something you could be tested on.** If you cannot write a question for it, it belongs
  in the track's `Outcome` line, not in the skills table.
- **No scores, bands, levels, percentages, or time estimates anywhere in this file.** Those are
  measured from evidence, and a guess formatted as a number reads as a measurement.
- Eight to fifteen tracks. If the subject needs more, the mission is too wide.

## What lives elsewhere

Lessons are not listed here. They are generated one at a time as the user works through a track, and
each lesson declares its own track in a `<meta name="mindforge:track" content="<slug>">` tag. This
file is an index of intent; the lessons are the record of what happened. When the two disagree, the
lessons are right.
