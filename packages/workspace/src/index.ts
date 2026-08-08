/**
 * `@mindforge/workspace` — the teach workspace as a value.
 *
 * Everything here is a pure function of bytes: composing the skill plugin,
 * hashing and diffing a file tree, parsing the `teach` skill's formats into
 * plain objects, and rendering `BRIEFING.md`. No filesystem, no Storage, no
 * Prisma, no Anthropic SDK — those live in `apps/worker` and `apps/api`.
 *
 * It exists as a package rather than inside `apps/worker` for the reason
 * `packages/db/src/rollup.ts` gives for itself: it has callers that provably
 * cannot import each other. The worker reindexes a run's output; the API renders
 * a conflict for a human to resolve, which means parsing both sides of it.
 *
 * It is deliberately **not** in `packages/core`, which `apps/web` imports — an
 * HTML parser has no business in the SPA bundle, and core's 100% coverage gate
 * is the wrong bar for parsers whose branches are mostly warnings about input
 * this repo cannot produce on purpose.
 */

export {
  SkillCompositionError,
  TEACH_PLUGIN_NAME,
  TEACH_SKILL_REF,
  buildTeachPlugin,
  skillName,
  stripModelInvocationGuard,
  type TeachPlugin,
  type TeachPluginSources,
} from "./skill/plugin.js";
