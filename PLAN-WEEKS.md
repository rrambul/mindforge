# Plan — missions in weeks, and practical labs

**Status, 2026-10-04:** decided, in progress. Requirements: FR-B1–B7 (the week calendar) and
FR-X11–X13 (labs) in `REQUIREMENTS.md` §6.4f and §6.4b. This replaces the committed, pace-proposed
module deadlines of `PLAN-EXAMS.md` (FR-U2, FR-U3, FR-U5), which were two days old and had no real
use behind them; the exams stay exactly as built.

## The change

A mission is planned in **weeks**. You say how many when you create it, and the curriculum fits the
subject into that many weeks:

- **one module per week**, exactly as many modules as weeks;
- **five lessons per module**, one per day on days 1–5 of the week (Monday to Friday when your week
  starts on Monday);
- **the module's exam on day 6** (Saturday), and day 7 is rest.

The dates are fixed when the mission is created. **Falling behind moves nothing**: the screen says
plainly how far behind you are ("Week 2: 3 of 5 lessons, 2 lessons behind"), and you may work ahead.
The pace projection stays, as one line: at your pace, this week's exam lands on that date.

Lessons are practical where practice makes sense. Besides code that runs in the app (`code`),
terminal work (`task`) and designs (`whiteboard`), a lesson may carry a **lab**: something done in a
real environment you own, like your AWS account, with the steps, a command that verifies it worked,
what it may cost, and the cleanup. The agent picks per lesson, and a conceptual lesson needs none of
them beyond its ordinary exercise.

## Decisions taken (2026-10-04, by the learner)

1. **Days 1–5 lessons, day 6 the exam, day 7 rest**, counted from the week start in the profile.
2. **The calendar is fixed.** Nothing slides and nothing locks. Behind is a count of lessons and a
   number of days, shown, never hidden and never punished.
3. **The calendar replaces committed deadlines.** `module_deadlines`, the commit and move endpoint
   and its prompt are removed. A module's deadline is its exam day. The pace projection stays as
   information.
4. **Practicals are mixed.** A new `lab` kind for work in a real environment; `task` and `code` stay;
   the agent chooses, and is told not to force one where reading and an in-app exercise teach better.

## Decisions taken here

- **A mission starts on the next week start**, today if today is one, unless the learner picks
  another week start when creating it. Starting mid-week would make the first days overdue on day one.
- **Weeks and the start are set at creation and not edited afterwards.** Changing the week count
  after the curriculum exists would mean replanning it; that is a new mission, or a later feature.
- **Missions created before this change have no calendar** (`weeks` null). They keep working exactly
  as before, with the pace projection and exams, and no dates.
- **The curriculum run is told the shape** and the reindexer checks it: a scheduled mission whose
  `CURRICULUM.md` does not have one module per week and five lessons per module indexes anyway, and
  the run says what is off. **A module keeps the week it was first given**: pinned on its row the
  first time it is indexed, never re-derived, so a revision cannot move a date. A lesson's day is
  its row in the plan; an off-plan lesson has none.
- **A lab is self-reported**, like a task: the app cannot see your AWS account, and the row says who
  decided. It never asks for credentials, and the report field says not to paste any.

## Principles kept

| Rule                       | Here                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Derived on read            | Week dates, lesson days, "behind" are computed in `packages/core`, never stored.          |
| Unknown is not zero        | An unscheduled mission has no dates rather than invented ones.                            |
| Honesty over encouragement | Behind is stated once, with the count. No streak, no alarm, no sliding to look on time.   |
| Files are canonical        | Week and day are derived from the plan's order, not written into `CURRICULUM.md`.         |
| Lesson HTML is untrusted   | A lab is a declaration the app renders; nothing in it runs anywhere but your own machine. |
