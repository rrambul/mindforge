# Changelog

Written for a reader, not derived from commit subjects. `release-please` produces the skeleton from
Conventional Commits and the release PR is where it is rewritten into plain sentences — a changelog
nobody can read is a git log with extra steps (`TECH-DESIGN.md` §14.1).

One version for the whole product. It is a single deployable with a single user; per-package versions
would be bookkeeping with no reader.

## 0.2.0

Mindforge became one thing. The previous release had nine feature pillars around a core that was
never finished; this one deletes eight of them and builds the ninth end to end — **a topic becomes a
curriculum, the curriculum is taught lesson by lesson, and the trackers tell you the truth about how
you are moving through it.**

### The flow, end to end (M3, M4, M5)

- **Ask for a curriculum, get one.** One button on a new mission and an agent maps the topic into
  modules, fundamentals first, with every lesson named up front — a title, a one-line intent, a
  difficulty for _you_, a depth, and which lessons it depends on. The first real one produced twelve
  modules and sixty-nine lessons in about three minutes.
- **Lessons are written one at a time, when you ask.** Pressing the same button again writes the
  next one: the first lesson that is unblocked and unfinished, chosen from the dependency graph
  rather than from a list. You get one lesson, not a module dumped at once, because the plan is meant
  to be revised by what the last lesson taught the agent about you.
- **Read them in the app.** A lesson is a document the agent wrote — text, diagrams, quizzes,
  simulators — and it opens in the reader with all of it working. It runs on a separate origin in a
  sandbox with no network access, because it is generated code and treating it as trusted would be a
  serious mistake. You should never notice that; you would notice if it were not true.
- **Say how it went, in one tap.** Understood, shaky, or lost, under the lesson. _Shaky_ is the
  honest answer most of the time and stays shaky until you redo the lesson — nothing decays it and
  nothing rounds it up. The module's fraction moves as you record it.
- **A module shows a real fraction and a real distribution.** Four of six done, two understood and
  one shaky and one lost. A module nobody has planned says so rather than showing 0%, and a lesson
  finished before outcomes existed is counted as finished-without-one rather than dropped.
- **What is locked, and why.** A lesson waiting on another says which one. A lesson many others are
  built on is marked as such, ranked by how many.
- **The library.** The documents the agent wrote to be revisited, and the record it wrote at the end
  of each lesson — what you learned, what proved it, what you struggled with, what it unlocks — read
  beside the lesson they came from.
- **The timer knows what you were doing.** Start a focus session from inside a lesson and the time is
  recorded against it, so "how long did this take" has an answer later.

### Changed

- **Eight feature areas were removed**: goals and typed targets, skills with scores and decay,
  friction tracking, the resource library, notes, weekly planning and reviews, notifications, and the
  planned work on spaced repetition, assessments and the skill galaxy. None of it was finished around
  a core that was not finished either. Each is listed in `NORTHSTAR.md` §5 with the condition that
  would bring it back, and the code is one revert away.
- **`RESOURCES.md` is now the agent's own file.** It still grounds what it teaches; it is no longer
  a library screen.

### Fixed

- **A lesson could not be read on a phone.** Every screen was wider than the viewport by exactly its
  own padding, so the right edge of everything was cut off.
- **Costs are recorded per model call and reconcile to what the run actually billed**, including the
  agent framework's own overhead — which turned out to be a fifth of the first run's bill and appears
  nowhere in the message stream.

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
