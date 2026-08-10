# End-to-end suite

Real browser, real stack, no mocks (`TECH-DESIGN.md` §13.2). Needs a running local Supabase:

```sh
supabase start
pnpm --filter @mindforge/web test:e2e
```

Playwright starts the API and the web dev server itself, and reuses them if you already have
`pnpm dev` open.

## What is covered

| Flow                                                       | File                      |
| ---------------------------------------------------------- | ------------------------- |
| Sign up → sign in → sign out                               | `auth.spec.ts`            |
| A new account is seeded from the browser it signed up in   | `signup-calendar.spec.ts` |
| Create a mission → teach it → a run is queued and reported | `teach.spec.ts`           |
| A mission card → its curriculum, empty state and all       | `curriculum.spec.ts`      |

## What is not, yet

These flows are still missing, listed here so the gap is a known one rather than something
rediscovered later:

- The capture loop: start focus → stop → debrief → appears on Today
- Generate a lesson → **run completes** → renders in the sandbox → mark outcome (M5, model stubbed).
  `teach.spec.ts` covers the first half of this: the button, the 202, and the card reporting a
  queued run. It stops there on purpose — the worker is not started by this config, and
  non-negotiable 8 forbids live API calls in the suite. The completion half needs a stubbed agent
  gateway, which arrives with M5's reader.
- Offline: go offline → start a session → reconnect → session persists exactly once
- A keyboard-only pass through the capture loop

The offline one is worth pulling forward: idempotency is easy to get wrong and silent when you do,
and the jsdom tests can only prove the queue's own rules, not that a real reconnect replays exactly
once.

## Why the config pins a locale and a timezone

`use.locale` is `en-US` and `use.timezoneId` is `UTC`, because a new account is now seeded from the
browser rather than left on UTC. Playwright's defaults are the machine's own, so without these a
signup writes whatever the developer happens to be in — and this suite asserts on weeks, which is
exactly the thing that then moves. A suite about days and weeks cannot be calibrated by the machine
running it.

`signup-calendar.spec.ts` overrides both, which is the point of it. It is also the only level that
can check the seeding at all: the profile row is made by a trigger on `auth.users`, the locale and
zone come from the browser, and the write goes through the settings endpoint — three processes, so a
unit test can assert what the client _sent_ and not what an account ends up holding.

It waits for the PATCH rather than for the sign-out button. `onAuthStateChange` fires inside
`signUp`, so the shell is on screen while the seed is still in flight — waiting on that alone raced
the write, passed because the server happened to finish first, and aborted the request mid-flight.

## What `teach.spec.ts` proves that nothing else can

The same shape as the M2 defect below, still available in M3. The button lives in `features/teach`,
the endpoint in the API's `teach` module, the card in `features/missions` — and nothing joins them
except a render prop threaded through `app/MissionsScreen`, because §2.2 rule 6 forbids one feature
importing another. Every unit test on both sides passes with that thread cut.

Confirmed to discriminate: deleting the `renderTeach` prop from `MissionsScreen` fails both of its
tests.

## What this suite caught that 365 jsdom tests did not

Worth recording, because it is the argument for the suite existing at all. M2 replaced the nav's
buttons with router links, and every unit test passed — they render features, not the shell. Two
Playwright assertions failed immediately, on `getByRole("button", { name: "Today" })`, because the
navigation genuinely no longer worked that way.

They now assert on URLs as well as on roles. Before the route tree there were none to assert, which
is exactly why a screen could not be linked to, bookmarked, or reached with Back before the route tree.

## A known blind spot

`auth.spec.ts` proves the session survives a reload. It does **not** catch the sign-in form flashing
while the stored session is still being read — `toBeVisible` retries until things settle, so a flash
passes. Confirmed by breaking the `sessionKnown` guard and watching the suite stay green.

That guard now lives in `Shell.tsx` rather than `App.tsx`, since the shell became the root route's
component — the check still holds, and the file to break is the new one.

Asserting the absence of a flash is an assertion about a moment rather than an outcome, and every
version of it is a race. So it is written down instead.

The suite does discriminate on what it claims to cover: breaking `supabase.auth.signOut()` fails four
of `auth.spec.ts`'s six tests. It was three of five until M2 added the sixth — signing in as somebody
else in the same tab — which depends on the same call.

## Why the coverage config points here

`apps/web/vitest.config.ts` excludes `App.tsx`, `Shell.tsx`, `router.tsx`, `providers.tsx`,
`features/auth/ui/**`, and `use-supabase-session.ts` from the unit coverage denominator, because a
jsdom test of them would assert that a mocked Supabase SDK returned what the mock was told to return,
or that `createRoute` returns a route. That exclusion is only honest while this suite exists and
runs — it did not, for the whole of M1.

`Shell.tsx` and `router.tsx` joined that list in M2 rather than being added to it: the shell is the
code that used to sit inside `App.tsx` and kept the exclusion when the route tree forced it into its
own file. Whether the paths in `router.tsx` are correct is checked here, by the URL assertions in
`auth.spec.ts`.
