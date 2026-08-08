/**
 * `@mindforge/workspace` — the teach workspace as a value.
 *
 * Everything here is a pure function of bytes: composing the skill plugin,
 * hashing and diffing a file tree, parsing the `teach` skill's formats into plain
 * objects, and rendering `BRIEFING.md`. No filesystem, no Storage, no Prisma, no
 * Anthropic SDK — those live in `apps/worker` and `apps/api`.
 *
 * It exists as a package rather than inside `apps/worker` for the reason
 * `packages/db/src/rollup.ts` gives for itself: it has callers that provably
 * cannot import each other. The worker reindexes a run's output; the API renders
 * a conflict for a human to resolve, which means parsing both sides of it.
 *
 * It is deliberately **not** in `packages/core`, which `apps/web` imports — an
 * HTML parser has no business in the SPA bundle, and core's 100% coverage gate is
 * the wrong bar for parsers whose branches are mostly warnings about input this
 * repo cannot produce on purpose.
 *
 * **Nothing here throws on bad input.** The `teach` formats are a contract
 * Mindforge does not control, and §7.4's rule is that a format change degrades to
 * "file stored, partially indexed" — never "run failed", never "content lost".
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

export {
  ASSETS_DIR,
  BRIEFING_FILE,
  CONFLICT_SUFFIX,
  LESSONS_DIR,
  MEMORY_ROOT,
  MISSION_FILE,
  NOTES_FILE,
  RECORDS_DIR,
  REFERENCE_DIR,
  RESOURCES_FILE,
  SYNC_EXCLUDE,
  WORKSPACE_ROOT,
  deslugify,
  isConflictCopy,
  isExcludedFromSync,
  memoryPrefix,
  parseNumberedFilename,
  slugify,
  workspacePrefix,
  type NumberedFile,
} from "./layout.js";

export { etagsMatch, normalizeEtag, sha256, storageEtag } from "./hash.js";

export {
  conflictPathFor,
  detectConflicts,
  diffWorkspace,
  writableChanges,
  type Change,
  type ChangeKind,
  type Conflict,
  type ConflictCheckInput,
  type FileState,
} from "./diff.js";

export {
  normalizeHeading,
  parseDocument,
  readSection,
  type Document,
  type Section,
} from "./markdown/sections.js";

export {
  checkReferences,
  parseLessonHtml,
  parseReferenceHtml,
  type ParsedHtmlDoc,
} from "./parse/html.js";
export { parseMission, type MissionHistoryEntry, type ParsedMission } from "./parse/mission.js";
export { parseLearningRecord, type ParsedRecord } from "./parse/record.js";
export {
  parseResources,
  type ParsedRejection,
  type ParsedResource,
  type ParsedResources,
  type ResourceType,
  type TrustLevel,
} from "./parse/resources.js";
export { warn, type ParseWarning, type Parsed, type WarningCode } from "./parse/result.js";
