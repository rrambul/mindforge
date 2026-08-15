# Changelog

Written for a reader, not derived from commit subjects. `release-please` produces the skeleton from
Conventional Commits and the release PR is where it is rewritten into plain sentences — a changelog
nobody can read is a git log with extra steps (`TECH-DESIGN.md` §14.1).

One version for the whole product. It is a single deployable with a single user; per-package versions
would be bookkeeping with no reader.

## [0.2.0](https://github.com/rrambul/mindforge/compare/v0.1.0...v0.2.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* refocus the product on the curriculum flow (v0.2)

### Added

* **api:** planning, insights, and a settings write path (M2) ([4908a5b](https://github.com/rrambul/mindforge/commit/4908a5b8c1b8a0a05b1881bc2bafe1e25d604c07))
* **api:** structured request logging with correlation ids ([b15a433](https://github.com/rrambul/mindforge/commit/b15a433676c3fcb7fc97968d52c731ede2bd997f))
* **api:** the reader's endpoints — open, complete, and the library (FR-T5, FR-P1, FR-T6, FR-F3) ([069ad5e](https://github.com/rrambul/mindforge/commit/069ad5edfe2f902e988c26769179c71eb94c647b))
* **api:** the request foundation — auth, problem+json, validation, RLS access (FR-A3) ([a61dfc1](https://github.com/rrambul/mindforge/commit/a61dfc1eae404fa49badbc88c5199eb74032df38))
* **core:** locale resolution and the server-side message bundle (FR-L1, FR-L6, FR-L7) ([9040aa7](https://github.com/rrambul/mindforge/commit/9040aa7794807db8ca8ac1ceba9560e23b5e2343))
* **core:** scoring, decay, bands, and friction classification ([93cff58](https://github.com/rrambul/mindforge/commit/93cff58ff01efc4f96c49d883d393fef0344cf12))
* **core:** the lesson outcome, the outcome tally, and the view grant (FR-P1, FR-P4, FR-T5) ([ad09baf](https://github.com/rrambul/mindforge/commit/ad09baf050416302211b0cba9356fc9e7a92c1e0))
* **core:** the resource contract, including type-specific progress (FR-R1, FR-R2, FR-R5) ([503594f](https://github.com/rrambul/mindforge/commit/503594f2586cdd7176c7afa07fd89127989d98dc))
* **core:** the weekly rhythm's maths, and the end of the ember/slag proxy (M2) ([360470a](https://github.com/rrambul/mindforge/commit/360470a48a391f94a92cdcdfac20766e5fbd1bfd))
* **curriculum:** plan lessons, not just tracks (FR-K2, FR-K5, FR-K6, FR-K7) ([3f70403](https://github.com/rrambul/mindforge/commit/3f70403c4f43ccaefd73288db4fbbb6270bf6b74))
* **curriculum:** show how a module's finished lessons landed (FR-P4) ([487b49a](https://github.com/rrambul/mindforge/commit/487b49a3ba4b66ba936ff5a22c9347e241a83f9b))
* **db:** a focus session can say which lesson the time bought (FR-F3) ([294b769](https://github.com/rrambul/mindforge/commit/294b7699766cea0bb685480e27bf0f3e59f66b25))
* **db:** capture-loop schema with RLS, and fix an account-deletion bug ([904fe94](https://github.com/rrambul/mindforge/commit/904fe94a334b0b357fb3d74e3d933e2846bb9011))
* **db:** seed:minimal, seed:rich, and the rollup they both needed (M0 → M2) ([3709104](https://github.com/rrambul/mindforge/commit/370910439548635711889f2cfff3d1414ef8b9f8))
* **db:** the teach workspace schema — runs, costs, the sync ledger, the index (M3) ([6e7f413](https://github.com/rrambul/mindforge/commit/6e7f4134d79d55452755f2baa6dd2dcd2e0118d3))
* **db:** the weekly rhythm's tables, and the primary key §3.3 could not have (M2) ([cf4dd2d](https://github.com/rrambul/mindforge/commit/cf4dd2dcb65e8b105a651f7cef71fbfff46eea5a))
* **focus,friction:** the capture loop's API (FR-F1, FR-F2, FR-F3, FR-C1, FR-C2, FR-C3) ([be9bfdb](https://github.com/rrambul/mindforge/commit/be9bfdbc2b1e96f5c3950cfa5ffae9774c9adbcd))
* **friction:** attribute an event to a skill or a resource (§5.3) ([45eddba](https://github.com/rrambul/mindforge/commit/45eddbafbbd196599eb0704f42b2da0f66bd72d6))
* **goals:** the goals screen (FR-M3, FR-M3b) ([0ced42a](https://github.com/rrambul/mindforge/commit/0ced42a51824d79d61adbb67423c1c826ab26d05))
* **goals:** typed targets with computed progress (FR-M3, FR-M3b) ([e00e1ff](https://github.com/rrambul/mindforge/commit/e00e1ff461ddcc94ad1d7257df3c71e02641105c))
* **lessons:** serve a workspace behind a signed grant (FR-T5) ([472233d](https://github.com/rrambul/mindforge/commit/472233d0ec169a55892bd8e2b0da5b2f653dc137))
* **missions:** create, edit with history, park, and the WIP limit (FR-M1, FR-M2, FR-M4, FR-M4b) ([0f3bbde](https://github.com/rrambul/mindforge/commit/0f3bbdebc1bb5fa97a5224520d03e25cddc12471))
* **missions:** raise the WIP limit to 10 (FR-M3) ([85f3542](https://github.com/rrambul/mindforge/commit/85f354285dab7b782ae78ab82a1696b9d1872405))
* **notes:** notes on anything, with real full-text search (FR-N1..N7) ([4adbc1f](https://github.com/rrambul/mindforge/commit/4adbc1f2de620e4d9727668241828c0662c3679c))
* **notes:** one tap from any resource, skill, or mission (FR-N1, M1) ([f1b662f](https://github.com/rrambul/mindforge/commit/f1b662faa197443e86d4424b341576f3b6c6dc21))
* refocus the product on the curriculum flow (v0.2) ([0bfc83c](https://github.com/rrambul/mindforge/commit/0bfc83c0dbe8e963ff56f5f012dc775b40424e33))
* **resources:** capture by URL, progress, finish, abandon (FR-R1..R6) ([1e760ca](https://github.com/rrambul/mindforge/commit/1e760ca6b2d6de7bd1a5b40534e1fc5eb52421c6))
* **resources:** index RESOURCES.md into the library (FR-T8) ([b38e405](https://github.com/rrambul/mindforge/commit/b38e405d6edfcf4b0a17118d510d7f83f893b96a))
* **resources:** link a resource to missions and skills (FR-R3) ([797cff6](https://github.com/rrambul/mindforge/commit/797cff63242e7bc73d00093c51d072bf86f925b6))
* **skills:** /teach-me — author a mission without paying for a run ([0dea042](https://github.com/rrambul/mindforge/commit/0dea0421be0babbf124f60e45e9264f9541da78e))
* **skills:** prerequisite DAG, self-rating, and the calibration gap (FR-S1, FR-S5) ([a09b99f](https://github.com/rrambul/mindforge/commit/a09b99f069a47954eda1eb618fa13b159fb1e80c))
* **skills:** the skills screen — gauge, calibration, prerequisite picker ([e55072c](https://github.com/rrambul/mindforge/commit/e55072c40860717522df7923001cf719d4d0eabd))
* **teach:** a daily spend ceiling, and a meter that reads llm_calls (FR-T8) ([9f44bb7](https://github.com/rrambul/mindforge/commit/9f44bb7d078e1eec16e3dab748996a95b943efa2))
* **teach:** learner memory — read, written, and yours to delete (§7.6) ([e41ff73](https://github.com/rrambul/mindforge/commit/e41ff7336e16b5682cf248046ba0c11f60448f8b))
* **teach:** one button, and the app picks which agent runs (FR-K1) ([1b4919a](https://github.com/rrambul/mindforge/commit/1b4919a27cc13532fd7305639314170d3146592c))
* **teach:** reindex parsed workspace files into Postgres (FR-T2, FR-T5, FR-T6) ([30e6eef](https://github.com/rrambul/mindforge/commit/30e6eefd61b7e1bf52afa57a337706be16984adb))
* **teach:** the agent-run lifecycle, and making @mindforge/api importable (FR-T3) ([3ac5856](https://github.com/rrambul/mindforge/commit/3ac58568516579d13632e1aa04cf85612303cb5d))
* **teach:** the briefing tells the agent how the finished lessons landed (FR-T3, FR-P1) ([81e8cf2](https://github.com/rrambul/mindforge/commit/81e8cf2137ac67bb1861462699d1446e6cbbc82f))
* **teach:** the dispatcher, and the briefing assembled from what is real (FR-T3, FR-T7) ([c0394f4](https://github.com/rrambul/mindforge/commit/c0394f4f60b3750b6b9945fb5fdcea989127d93a))
* **tracker:** a mission progress bar and reading as activity (FR-P3, FR-F5) ([2eefb30](https://github.com/rrambul/mindforge/commit/2eefb30035283487aec26af766b73c60f1bc9535))
* versioning, the changelog, and a /v1/health that answers the question (§14.1) ([b864398](https://github.com/rrambul/mindforge/commit/b864398ecb1a174bdc877e849b0ce3afdf345ddc))
* **web:** command palette and the guided first mission (M1) ([45d9faa](https://github.com/rrambul/mindforge/commit/45d9faa27f73e6c06ebdb9180a498bf3c5ab65da))
* **web:** give the lesson the width of a document, and the seed a stylesheet ([752e323](https://github.com/rrambul/mindforge/commit/752e3238b14edff422b8e9e35920300bcfe6c336))
* **web:** log a session you forgot to time (FR-F2) ([04a734d](https://github.com/rrambul/mindforge/commit/04a734d3b7c236e81ee938d3c11badd37de12636))
* **web:** notes on screen — one tap mid-session, and search (FR-N3, FR-N6) ([e6c6c2f](https://github.com/rrambul/mindforge/commit/e6c6c2ffd73609e296cbe6f780bc9e2bd2fd1655))
* **web:** offline queue for the capture paths (§5, §6.1) ([0558c07](https://github.com/rrambul/mindforge/commit/0558c07109ba65813f882b7c9a97313f660b926a))
* **web:** read a lesson, and say how it went (FR-T5, FR-P1, FR-T6, FR-F3) ([ef8ce6a](https://github.com/rrambul/mindforge/commit/ef8ce6aa53841894e2dda7277d2c5257838410ff))
* **web:** Teach me the next thing (FR-T3) ([246c617](https://github.com/rrambul/mindforge/commit/246c617d54a60b1aac63d7ef926c3abbed61750f))
* **web:** the app shell, and a missions screen you can actually use ([684f6a6](https://github.com/rrambul/mindforge/commit/684f6a6536ea869139bb7bd06fd7009dbead6a2b))
* **web:** the capture loop on screen — Today, the timer, and the chips (§5.1, §5.3) ([ab80f6c](https://github.com/rrambul/mindforge/commit/ab80f6c078a6ee17c82b82ddc504c7070e32cd23))
* **web:** the learner-memory review screen (§7.6) ([52b1b04](https://github.com/rrambul/mindforge/commit/52b1b04410603fe6fb43cfc905a89f8006cec6f5))
* **web:** the mark, the icons, and three components the cards were missing ([7c0102c](https://github.com/rrambul/mindforge/commit/7c0102c74df256aa2d600af08302e26e6e75d1ec))
* **web:** the weekly rhythm on screen — plan, review, insights, settings (M2) ([9833933](https://github.com/rrambul/mindforge/commit/9833933fed83d308344abce586deb2418de51ff6))
* **worker:** materialize and sync a teach workspace through Storage (FR-T1, FR-T2) ([d4c2375](https://github.com/rrambul/mindforge/commit/d4c2375df016f2f9100468720cdfbd5103e54b51))
* **worker:** teach runs authenticate by API key or by Claude Code login (§11) ([ac02038](https://github.com/rrambul/mindforge/commit/ac0203832a133ed190966f4389a191d3de3ed4f7))
* **worker:** the nightly rollup, stall detection, and a process that stays alive (M2) ([c49ca7c](https://github.com/rrambul/mindforge/commit/c49ca7c5e646150241c98975f54107444baa2926))
* **worker:** the teach run loop, behind a port and driven by transcripts (FR-T3) ([c4b4a8e](https://github.com/rrambul/mindforge/commit/c4b4a8e5dfc3b29c231024ce6df894d80cfe6ee6))
* **workspace:** BRIEFING.md, and the absences it must not round to zero (FR-T7) ([bcedb1b](https://github.com/rrambul/mindforge/commit/bcedb1b998156f2745e4b7650ea54f82a8dca981))
* **workspace:** defensive parsers for the teach formats (FR-T2, FR-T6, FR-T8) ([9ccb738](https://github.com/rrambul/mindforge/commit/9ccb738e6d3416c73e33283821e79eb76c306880))


### Fixed

* **build:** no Nest app could boot — give the packages a real build (M0 gap) ([0ac7cd3](https://github.com/rrambul/mindforge/commit/0ac7cd3e4fd09a6aea676d923b31bc3b724072b1))
* **ci:** run eslint --fix before prettier in lint-staged ([081aa88](https://github.com/rrambul/mindforge/commit/081aa887099f3c696eec077b3fbcda2cbfdaeeba))
* **db:** handle possibly-empty query result in the cascade test ([0736c93](https://github.com/rrambul/mindforge/commit/0736c931393418ecdb96665e57635d37d3102075))
* **db:** let prisma generate run without a database ([4b755a9](https://github.com/rrambul/mindforge/commit/4b755a9ae3c0ef7695027586715582555a9d478a))
* **db:** restore the explicit transaction generic in asUser ([c151413](https://github.com/rrambul/mindforge/commit/c151413140fae09a27f37b21657768306535c543))
* **db:** the seed scripts needed a build that nothing had run ([6c54685](https://github.com/rrambul/mindforge/commit/6c5468539c6562f0c4fd9bd13bf354715f48bd56))
* **db:** withRls isolated nothing — replace it with runAsUser (FR-A3) ([28fe070](https://github.com/rrambul/mindforge/commit/28fe070304785b73e79f8e1de666c5677d7e0bda))
* **focus:** a session could not be filed under anything, so no plan had an actual ([cb0d0ce](https://github.com/rrambul/mindforge/commit/cb0d0ce95f3e6b69a9e8d395a252a1f21c29fdef))
* **focus:** file a retroactive session against its subject too (FR-F2) ([5cb77f2](https://github.com/rrambul/mindforge/commit/5cb77f223e44d4dbd0fe054bad2b6523b5aadd26))
* **lessons:** the health route skipped the method check and the security headers ([e9a7336](https://github.com/rrambul/mindforge/commit/e9a733635251d7ba3d8ed6390fac2b4c1108fc56))
* **lint:** the architectural boundary rules enforced nothing (TECH-DESIGN §2.1, §2.2) ([2d5b5b9](https://github.com/rrambul/mindforge/commit/2d5b5b95bae14829cad0a10b758461aed60fbaeb))
* **planning:** close the weekly review's friction window at both ends ([aaa2d75](https://github.com/rrambul/mindforge/commit/aaa2d75053986fab4647e4a44f76fd5fb843c862))
* six review findings, all real ([f3d6326](https://github.com/rrambul/mindforge/commit/f3d6326954897a749becf5c8eac06f794616f24a))
* **skills:** /teach-me is a command, not a skill in a directory nothing reads ([5dfc9f3](https://github.com/rrambul/mindforge/commit/5dfc9f3a6712c9044cd67acbea29e444cb46620e))
* **teach:** Skill is a tool, and omitting it made every run useless (FR-T3) ([8b6f136](https://github.com/rrambul/mindforge/commit/8b6f13659d97c49a7a33fc95e3e19adcf4b54980))
* **teach:** three defects a real run found, and the loop it walked (M5, M4) ([85c714d](https://github.com/rrambul/mindforge/commit/85c714db6df5afb8a8a9a5e5b15aebaa0ba2cf75))
* ten defects from the M1 review, each with a test that catches it ([4fcf19e](https://github.com/rrambul/mindforge/commit/4fcf19efda8b86c3a17c868d350cfe8b29c84399))
* the last six review findings, and two rules that existed twice ([6f558ee](https://github.com/rrambul/mindforge/commit/6f558ee2a54fd1d8895708576d8e01eb0ba84c48))
* the stall nudge never named its mission, and the cache outlived sign-out ([8d6b7c6](https://github.com/rrambul/mindforge/commit/8d6b7c68f2927bf234a452d9fa783cdc984333c3))
* three ways a capture or a review could be lost without anyone noticing ([ca442bb](https://github.com/rrambul/mindforge/commit/ca442bbc2b598385608994e5a44a6dd328afe559))
* two silent misconfigurations that only surface in a browser ([e866cf3](https://github.com/rrambul/mindforge/commit/e866cf30d4d7548e93730bcca870563822d210b1))
* **web:** arrange the top bar's wrap instead of leaving it to chance ([d8c323c](https://github.com/rrambul/mindforge/commit/d8c323ca6569af39df1b6e4e4183bb506eb266f3))
* **web:** every screen scrolled sideways on a phone, by exactly its own padding ([68a9d6f](https://github.com/rrambul/mindforge/commit/68a9d6f3ad01fe304d03949943073248a68e95ae))
* **web:** one offline queue per user, not per device (§6.1) ([e5309a5](https://github.com/rrambul/mindforge/commit/e5309a51c1d1f0748510b3c62791896f6595b096))
* **web:** seed a new account's calendar from its browser (FR-L1, FR-L2, FR-L3, FR-L5) ([64dda51](https://github.com/rrambul/mindforge/commit/64dda51a4db32044dc4712c8e0feca26c94f9b4c))
* **web:** the outcome tray was transparent, and named three tokens that do not exist ([d51527f](https://github.com/rrambul/mindforge/commit/d51527f78669be1aec3159af2e99d2d772b8d401))
* **web:** the SVG favicon was invalid XML and had never rendered ([170bbf2](https://github.com/rrambul/mindforge/commit/170bbf22194ecdb106e8dd2f4fd66abef3aa540c))
* **worker:** dispatch teach runs round-robin between learners ([d9d5f60](https://github.com/rrambul/mindforge/commit/d9d5f60ca914a2add3c78462afca7c8f50c8604d))
* **worker:** the loader crash that only ever showed up as a restart line ([541b810](https://github.com/rrambul/mindforge/commit/541b81039288934e2099700a30bf22a15a707654))


### Changed

* **core,api,web:** declare every response shape once (§7.5, §6.1) ([1ed27e8](https://github.com/rrambul/mindforge/commit/1ed27e82d69c6ee4baaebeae0dbb9dbdcf652477))
* release 0.2.0 ([ba86bbc](https://github.com/rrambul/mindforge/commit/ba86bbc247ddc7e4bb869b35ec53076939f4ed3d))
* **web:** make shared/ui an actual component library ([66ea86e](https://github.com/rrambul/mindforge/commit/66ea86e81305ac698a309bfba926ae4f4889f876))
* **web:** the route tree both App.tsx and AppShell.tsx kept deferring (M2) ([2fb1ff4](https://github.com/rrambul/mindforge/commit/2fb1ff437650c56b4a88b0ad90acc24a7fd2f0c1))
* **workspace:** split the curriculum parser along its own seam ([b867056](https://github.com/rrambul/mindforge/commit/b867056d9573d78d8d1bb08c2710307fb48f2a5b))

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
