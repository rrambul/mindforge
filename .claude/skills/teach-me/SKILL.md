---
name: teach-me
description: Author a Mindforge mission end to end — interview, curriculum, modules and the first lesson — by following the repo's own curriculum and teach skills and landing the files through the real reindexer. Use when the user says "/teach-me", asks you to create a mission or a curriculum, or asks you to write a lesson for an existing mission.
---

# Author a mission, without paying for a run

You are doing by hand what `apps/worker` does unattended: producing a teach workspace and letting
Mindforge index it. The product's own path is the button in the app (FR-K1) and it is what a real
user does. This exists because a run costs money and minutes, and because non-negotiable 5 says the
files are canonical — a person with a terminal must be able to write them.

**You are the agent here.** Everything the unattended run is told, you are told, by the same files.

## The two skills you are running

Read them from this repository, not from memory, and read them **before** writing anything:

| Step             | Read                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| The curriculum   | `skills/curriculum/SKILL.md` and `skills/curriculum/CURRICULUM-FORMAT.md` |
| A lesson         | `skills/teach/SKILL.md` and `skills/teach/LEARNING-RECORD-FORMAT.md`      |
| The mission file | `skills/teach/MISSION-FORMAT.md`                                          |

`skills/teach/` is a verbatim copy of the upstream Claude Code skill and `skills/README.md` forbids
editing it — read it, follow it, never change it. `skills/UNATTENDED.md` and
`skills/CURRICULUM-UNATTENDED.md` are Mindforge's addenda, appended at build time for a server run.
**Most of what they say does not apply to you**: they exist because nobody is present. You have the
user in front of you, so where the addendum says "never ask, assume and write", you ask.

**One skill per step, never both.** A curriculum step writes `CURRICULUM.md` and no lessons; a lesson
step writes a lesson and never touches `CURRICULUM.md`. That separation is the product's, not a
style preference — structure has to be revisable without discarding material.

## Step 1 — interview

The curriculum skill is explicit that a curriculum written without the mission is the generic
syllabus that is on every blog, "which is worse than nothing because it looks right". So ask, and do
not start until you have real answers. Cover exactly what `MISSION-FORMAT.md` asks for:

- **Topic** — one line.
- **Why** — the real reason, in their words. This is the field that makes the curriculum theirs.
- **Success looks like** — observable outcomes. Push back on "understand X"; ask what they would be
  able to _do_.
- **Constraints** — time per day, budget, equipment, anything that shapes lesson design.
- **Current level** — honestly, including what they have already tried and where it went wrong.

Ask them together, in one message, as a short numbered list. Do not interrogate one field at a time.

If an answer is vague, say which one and why it matters, then ask once more. If it is still vague,
write the curriculum anyway and bias toward fewer tracks — a short curriculum grounded in little is
honest; a long one is a guess with more surface area.

## Step 2 — the mission

Ask whether they already have a mission in the app.

- **Existing** — ask for the id, or find it: `select id, topic, workspace_key from missions where user_id = ...`.
- **New** — create it through the API, so the WIP limit and the revision history behave as they do
  for anyone else. Sign in as the account they name:

```sh
cd ~/brain-gym && set -a && . ./.env.local && set +a
TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' \
  -d '{"email":"<email>","password":"<password>"}' | jq -r .access_token)
curl -s -X POST http://localhost:3000/v1/missions -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"topic":"...","why":"...","successLooksLike":"...","constraints":"...","currentLevel":"..."}' | jq
```

**A new mission has no `workspace_key`.** The API assigns it when a run is first queued, and
`put:workspace` refuses without one. Set it to the slug of the topic — the same value
`deriveWorkspaceKey` would produce, so a later real run finds this workspace instead of starting a
second history beside it:

```sh
docker exec -i supabase_db_brain-gym psql -U postgres -d postgres \
  -c "update missions set workspace_key = '<topic-slug>' where id = '<mission-id>'"
```

## Step 3 — write the files

Stage them in a scratch directory laid out exactly like a workspace, then land the whole directory at
once. The layout is `skills/teach/SKILL.md`'s and `TECH-DESIGN.md` §7.2's:

```
MISSION.md              from MISSION-FORMAT.md, filled in from the interview
CURRICULUM.md           from CURRICULUM-FORMAT.md — 8–15 tracks, a module table each
RESOURCES.md            what you grounded it in, as RESOURCES-FORMAT.md wants
lessons/0001-<slug>.html
assets/…                the shared stylesheet first, then anything a second lesson could reuse
reference/<slug>.html   only when the lesson produced something worth revisiting
```

Two things a lesson must carry in its `<head>`, or it indexes into nothing:

```html
<meta name="mindforge:track" content="<track-slug>" />
<meta name="mindforge:lesson" content="<planned-lesson-slug>" />
```

The first files it under its module; the second claims its row in the plan. Without the second the
module counts the lesson twice — once as written and once as still to come.

Write **one lesson per step and stop**, the same rule the unattended run has. Ask before writing a
second.

## Step 4 — land it

```sh
cd ~/brain-gym && set -a && . ./.env.local && set +a
pnpm --filter @mindforge/worker put:workspace -- --mission=<id> --from=<staging-dir>
```

It uploads to Storage and then runs the same `ReindexWorkspace` a real run's sync-back runs, so the
result is indistinguishable from an agent's. Read what it prints:

- `tracks` / `plannedLessons` after a curriculum step, `lessons` after a lesson step.
- Any `warning:` line means "stored, partially indexed" (§7.4) — the file landed and something in it
  did not parse. Say which line, and offer to fix it.

Then tell the user where to look: `http://localhost:5173/missions/<id>`.

## What must be running

`supabase start` and `pnpm dev`. The reader needs the lessons origin on :3001 — without it every
lesson is an empty frame.

## Things that will bite

- **`storage_path` is workspace-relative.** `put:workspace` handles it; do not hand-write rows.
- **Never write `.claude-config/` or `BRIEFING.md` into the staging directory.** They are excluded
  from sync, and the exclusion exists because a real run once uploaded its own session transcript as
  the learner's content.
- **Do not run `seed:rich` afterwards.** It wipes `dev@mindforge.local` and everything under it.
- **Do not invent the mission.** If you find yourself writing a `Why` the user did not say, stop and
  ask. That field is the difference between their curriculum and a blog's.
