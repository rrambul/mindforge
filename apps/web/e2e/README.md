# End-to-end suite

Real browser, real stack, no mocks (`TECH-DESIGN.md` §13.2). Needs a running local Supabase:

```sh
supabase start
pnpm --filter @mindforge/web test:e2e
```

Playwright starts the API and the web dev server itself, and reuses them if you already have
`pnpm dev` open.

## What is covered

| Flow                         | File           |
| ---------------------------- | -------------- |
| Sign up → sign in → sign out | `auth.spec.ts` |

## What is not, yet

§13.2 names eight flows. These are the seven still missing, listed here so the gap is a known one
rather than something rediscovered later:

- The capture loop: start focus → log friction → stop → debrief → appears on Today
- Add a resource by URL → update progress → abandon with reason
- Weekly plan → log sessions → weekly review shows plan vs. actual (M2)
- Generate a lesson → run completes → renders in the sandbox → mark outcome (M4, model stubbed)
- Review queue: due items → answer → schedule moves (M5)
- Offline: go offline → log friction → reconnect → event persists exactly once
- A keyboard-only pass through the capture loop

The offline one is worth pulling forward: idempotency is easy to get wrong and silent when you do,
and the jsdom tests can only prove the queue's own rules, not that a real reconnect replays exactly
once.

## A known blind spot

`auth.spec.ts` proves the session survives a reload. It does **not** catch the sign-in form flashing
while the stored session is still being read — `toBeVisible` retries until things settle, so a flash
passes. Confirmed by breaking the `sessionKnown` guard in `App.tsx` and watching the suite stay green.

Asserting the absence of a flash is an assertion about a moment rather than an outcome, and every
version of it is a race. So it is written down instead.

The suite does discriminate on what it claims to cover: breaking `supabase.auth.signOut()` fails three
of the five tests.

## Why the coverage config points here

`apps/web/vitest.config.ts` excludes `App.tsx`, `providers.tsx`, `features/auth/ui/**`, and
`use-supabase-session.ts` from the unit coverage denominator, because a jsdom test of them would
assert that a mocked Supabase SDK returned what the mock was told to return. That exclusion is only
honest while this suite exists and runs — it did not, for the whole of M1.
