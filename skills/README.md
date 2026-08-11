# `skills/`

`teach/` is a **verbatim copy** of the upstream Claude Code skill (`~/.claude/skills/teach/`). Do not
edit it. Its whole value is that `diff -r skills/teach ~/.claude/skills/teach` is empty — §7.1 chose
the Agent SDK so that the cloud agent and a local `/teach` run read the same instructions, and that
argument only holds while these bytes match.

`UNATTENDED.md` is Mindforge's own. The skill was written for a human sitting at a terminal, and a
server run has no human: it cannot answer a question, confirm a mission change, or run a CLI command
to open a file. Rather than fork `SKILL.md` — which would break the paragraph above — the addendum is
appended at build time. It also carries the parts of the track model `teach` cannot know about,
for the same reason: the upstream skill has no concept of a curriculum.

`curriculum/` is Mindforge's own skill, not vendored. It maps a subject into ordered subtopics and
writes `CURRICULUM.md`; it writes no lessons. Structure and material are produced by separate skills
so the structure can be revised without discarding the material.

Neither directory is Mindforge tooling for _you_: `.claude/commands/teach-me.md` is the command that
reads both of these and writes a workspace by hand, for when a real run is not worth its cost. It
follows them; it never copies them.

Neither directory is what the agent reads. `buildTeachPlugin()`
(`packages/workspace/src/skill/plugin.ts`) composes them into a Claude Code **plugin** directory,
because a plugin is the one mechanism that binds a skill to an arbitrary `cwd`. Copying `SKILL.md`
into the workspace does not make it a skill, and the upstream frontmatter declares
`disable-model-invocation: true`, which would leave it loaded and permanently uninvokable. Both are
handled there, and `TECH-DESIGN.md` §7.3 says why at length.

## Updating the vendored skill

```sh
cp ~/.claude/skills/teach/*.md skills/teach/
pnpm --filter @mindforge/workspace test:unit   # the fixtures pin the headings the parsers match on
```

A heading that changed upstream will fail a parser test rather than silently produce a workspace that
indexes into nothing. That is the point of pinning them.
