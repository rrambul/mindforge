# Plan — exams and deadlines

> **Superseded in part, 2026-10-04.** The committed, pace-proposed deadlines below (decisions 7–9,
> FR-U2, FR-U3, FR-U5, `module_deadlines`, the commit endpoint and its prompt) were replaced by the
> week calendar in `PLAN-WEEKS.md`. The exams, the pace estimate and the projection stand.

**Status, 2026-10-02:** Phases 1–4 are built and tested; unproven by a real `generate_exam` run. The requirements are FR-E1–E8 (exams) and
FR-U1–U6 (deadlines and the schedule) in `REQUIREMENTS.md` §6.4e and §6.4f; the data model is
`TECH-DESIGN.md` §3.2d and the maths §9.5. As each phase lands its detail moves into those docs and
this file shrinks to what is still open.

## The problem

Two things, and the learner named both.

1. **Nothing proves a module was learned.** The only signal is understood / shaky / lost, which is
   self-reported. The exercises inside lessons are practice, judged as evidence about the _lesson's_
   difficulty and never about the learner (`PLAN-HANDS-ON.md` decision 2).
2. **Nothing ends a module.** A module is finished when every lesson is marked done, and nothing
   says when that should be. A module can stay at 4 of 6 forever, and the grid will show you turning
   up while it does.

## The goal

Every module ends in **an exam**: a real test the agent writes once the module's lessons are done,
covering only what those lessons taught, taken in the reader with the same runner, whiteboard and
task kinds the lessons use. Every module also has **a deadline**: when you start it, Mindforge
estimates how long it will take from how you have actually been working, proposes a date, and you
commit to one. The exam is scheduled for that date. Together they make the **schedule**: every
module of a mission in order, each with its exam date, committed or projected.

## Decisions taken

1. **This does not wait for the M6 soak** (decided 2026-10-02 by the learner: "I need the deadline
   so I don't procrastinate forever to finish a module"). `NORTHSTAR.md` §5 now records that two of
   its rows came back and which conditions they met; §6 rule 5 names this as its second exception.
2. **"Submodule" means module.** The hierarchy is mission → module (track) → lesson. There is no
   level in between, and an exam belongs to a module.
3. **An exam is a lesson file that says it is an exam** — `<meta name="mindforge:kind"
content="exam">` in `lessons/NNNN-…html` — indexed onto a `lessons` row with `kind = 'exam'`. That
   gets the reader, the grant, the exercise runner, attempts, reviews and self-reports for nothing,
   and keeps the workspace layout byte-identical to a local one (no Mindforge-only directory). The
   cost is that every lesson derivation must leave exams out, and `packages/core` is where that rule
   lives.
4. **The exam is written after the module's lessons, not before.** Written at the start, it could
   only test the plan; written at the end, it tests the lessons as they were actually taught, and
   can aim at the ones that landed shaky.
5. **An exam is passed when every item is passed**, the same rule as a lesson exercise's tests and
   a whiteboard rubric. No invented pass mark. "4 of 6" is shown as 4 of 6.
6. **No help in an exam, and no answers in it.** Hints are refused by the server on an exam item
   until it is passed, and nothing that is the answer is _sent_ before then either: no solution,
   no whiteboard rubric, and a review's lines reduced to their verdicts. An exam file carries no
   solutions at all, because its source is readable from the frame; the parser drops any and the
   run says so. A pass after seeing the answer is not a pass.
7. **The deadline is a commitment, not a derived number.** The estimate proposes; the learner
   commits. A date that silently tracked your pace would be a forecast. The commitment is stored,
   append-only; moving it is a new row, and the screen shows the original date and how many times
   it moved. The projection is derived on read and always shown beside it.
8. **The estimate refuses to guess.** It needs at least three finished lessons with focus time bound
   to them, and some focus time on this mission in the last 28 days. Without either it returns null
   with the reason, and the learner picks the date themselves. A default "30 minutes a lesson" would
   be a guess presented as a measurement.
9. **A missed deadline is a fact, not a punishment.** "Due 30 Sep, 4 of 6 lessons, 2 days over":
   no red alarm, no guilt copy, no streak. A module finished late says how late.
10. **The exam does not lock the next module.** `track_edges` already sequences modules. The "next
    thing" button does offer the exam before the next module's lessons, because finishing a module
    means sitting its exam.

## Principles this has to keep

| Existing rule                                  | What it means here                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Files are canonical (non-negotiable 5)         | The exam is a workspace file; `/teach-me` in a terminal can write one by following `skills/EXAM-SHAPE.md`.              |
| Core owns domain math (non-negotiable 3)       | `estimateModule`, `projectSchedule`, `deadlineStatus` and `examResult` live in `packages/core`, once.                   |
| Unknown is never zero                          | No estimate without data; no exam result before an attempt; a module with no plan has no projection.                    |
| Honesty over encouragement (non-negotiable 10) | A moved deadline shows that it moved. A self-reported exam item is shown as self-reported. A late finish says how late. |
| The run kind is inferred                       | `generate_exam` is chosen by the server from the curriculum's state, never sent by the client.                          |
| A new table ships with RLS and a test          | `module_deadlines` has owner policies, a track-ownership check on insert, and an RLS test.                              |
| Lesson HTML is untrusted (non-negotiable 7)    | Unchanged. An exam is a lesson file and gets exactly the same frame, CSP and grant.                                     |
| Cost tracking on every call (non-negotiable 9) | An exam run is a teach run: same `llm_calls` reconciliation, same daily budget.                                         |

## Reserved requirement IDs

- **FR-E** — exams
- **FR-U** — deadlines and the schedule (`FR-S`, the obvious letter, is a retired v0.1 prefix)

---

## Phase 1 — The maths (`packages/core`) — built 2026-10-02

- `exams/exam-result.ts` — `examResult(items)`: per item not tried / failed / passed, checked versus
  self-reported, passed overall, when it was passed, and which lessons the failed items cover.
- `schedule/estimate.ts` — `minutesPerLesson`, `dailyPace`, `estimateModule`, `projectSchedule`.
- `schedule/deadline.ts` — `currentDeadline`, `deadlineStatus`.
- `ExerciseBase` gains `covers: string[]` (default `[]`): the lesson slugs an exam item examines.
- Wire schemas: the curriculum view gains `exam`, `deadline`, `projection` per module, and the
  mission gains a `schedule` basis. `SetDeadlineSchema` for the request.

## Phase 2 — Storage (migration `20261002120000_exams_and_deadlines`) — built 2026-10-02

- `lessons.kind` (`lesson` | `exam`), CHECKed; an exam is always `generated` and claims no plan.
- `module_deadlines` (append-only): `user_id`, `track_id`, `due_on date`, `created_at`. RLS owner
  select / insert (track must be the user's) / delete.
- `agent_runs_kind_known` gains `generate_exam`.

## Phase 3 — Writing the exam — built 2026-10-02

- `parse/html.ts` reads `mindforge:kind`; the reindexer writes `lessons.kind`.
- `skills/EXAM-SHAPE.md`, appended to the teach plugin for an exam run.
- The briefing's exam section: the module, its written lessons with outcomes and their exercises,
  and the exact tags.
- `TeachRuns.request` infers `generate_exam`; the worker's verdict requires an exam file.

## Phase 4 — Taking the exam and keeping the deadline — built 2026-10-02

- The reader knows a lesson is an exam: no outcome chips, a results panel instead.
- The exercises module refuses hints and solutions on an unpassed exam item.
- `PUT /v1/missions/:missionId/modules/:moduleId/deadline` commits or moves a deadline, and answers
  with the whole curriculum.
- The curriculum screen: each module's exam state, deadline and projection; the schedule; a
  "set a deadline" prompt on the module you are in.

## Open questions

- **Does the estimate's median hold up?** It ignores difficulty and depth on purpose until there is
  enough history to split by them. Revisit once a mission has twenty timed lessons.
- **Should a failed exam bring a review lesson?** Today the failed items name the lessons they
  cover, and a retake is the next attempt. A "review" run kind is the obvious next step and is not
  built.
- **Does the mission card need the due date?** It would mean the missions list reading the
  curriculum. Left off until the curriculum screen proves not to be enough.
