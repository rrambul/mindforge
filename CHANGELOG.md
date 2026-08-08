# Changelog

Written for a reader, not derived from commit subjects. `release-please` produces the skeleton from
Conventional Commits and the release PR is where it is rewritten into plain sentences — a changelog
nobody can read is a git log with extra steps (`TECH-DESIGN.md` §14.1).

One version for the whole product. It is a single deployable with a single user; per-package versions
would be bookkeeping with no reader.

## 0.1.0

The first release with a version at all. Everything below already existed; this is the point at which
the app started being able to tell you what it is running.

### The weekly rhythm (M2)

- **Weekly plans.** Set target minutes per mission or skill for a week, and see them against what you
  actually did. Unplanned work is shown as work you did without planning it, not as being over target.
- **The weekly review.** A guided end-of-week screen: what moved, what stalled, where the friction
  went, and one field for the one thing you are changing because of it.
- **The activity grid.** A year of days where the shade is how long you spent and the colour is
  whether it was the productive kind. A day you did not annotate stays neutral rather than grey,
  because grey is a claim and an unannotated day has not been measured. Alongside it, active days in
  the last 28 — not a streak, which is a counter that only ever punishes you.
- **Backlog health.** How fast the library is growing against how fast you finish things, what has
  been started and left, and why you abandoned what you abandoned.
- **Quiet nudges.** A weekly review reminder at an hour you pick, and a question when a mission has
  gone quiet — "still active, or park it?". In-app only. Nothing pushes, nothing makes a sound, and
  nothing interrupts a focus session.
- **Settings.** Timezone, interface language, the language lessons are written in, which day your
  week starts on, and theme. Before this the timezone could not be changed, which meant every "day"
  in the app was really a UTC day.
- **Real URLs.** Every screen can be linked to, bookmarked, and reached with the Back button.

### Honesty fixes

- **The ember/slag ratio was counting events, not minutes.** It now divides a session's own length
  among the friction you logged in it, weighted by how bad each one was — the intensity you have been
  recording since the beginning and which nothing read until now. A session where you logged nothing
  counts toward your hours and toward neither side of the ratio, because an hour you did not examine
  is not an hour of demonstrated productive struggle.
