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
  formatted as a number reads as a measurement.
- Eight to fifteen tracks. If the subject needs more, the mission is too wide.

## What lives elsewhere

Lessons are not listed here. They are generated one at a time as the user works through a track, and
each lesson declares its own track in a `<meta name="mindforge:track" content="<slug>">` tag. This
file is an index of intent; the lessons are the record of what happened. When the two disagree, the
lessons are right.
