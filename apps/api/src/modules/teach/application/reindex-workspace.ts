import { dayBounds, isIsoDate, resolveTimeZone, skillSlug } from "@mindforge/core";
import {
  CURRICULUM_FILE,
  deslugify,
  isConflictCopy,
  LESSONS_DIR,
  parseCurriculum,
  parseLearningRecord,
  parseLessonHtml,
  parseMission,
  parseNumberedFilename,
  parseReferenceHtml,
  parseResources,
  RECORDS_DIR,
  REFERENCE_DIR,
  sha256,
  warn,
  type ParseWarning,
} from "@mindforge/workspace";
import { Inject, Injectable } from "@nestjs/common";

import { CLOCK, type Clock } from "../../../shared/time/clock.js";
import { UpdateMission } from "../../missions/application/update-mission.js";
import { SyncWorkspaceResources } from "../../resources/application/workspace-resources.js";
import {
  curriculumSkillSlug,
  SyncCurriculumSkills,
} from "../../skills/application/workspace-skills.js";
import {
  WORKSPACE_INDEX_REPOSITORY,
  type IndexedLesson,
  type IndexedRecord,
  type IndexedReferenceDoc,
  type IndexedTrack,
  type WorkspaceIndexRepository,
} from "./index.port.js";

/**
 * Parsed workspace files → Postgres (FR-T2, FR-T5, FR-T6).
 *
 * Files are canonical and this is a rebuildable index (non-negotiable 5), which
 * shapes every decision here: nothing throws on bad input, everything is an
 * upsert keyed on something the *file* determines, and a file that will not parse
 * is stored and partially indexed rather than failing the run.
 *
 * **Whoever owns the table owns the write.** The three tables the teach module
 * owns are written directly. `MISSION.md` goes through `UpdateMission`, which is
 * §2.1 decision 2 — and here it also removes a trap the design walked into.
 *
 * ### `## History` is deliberately not indexed
 *
 * The obvious reading of §7.4's parser table is that `MISSION.md` maps to
 * `missions` *and* `mission_revisions`, so the history section becomes revision
 * rows. That is wrong twice over. `mission_revisions` has no unique constraint
 * and the section does not shrink, so re-parsing it every run triples the ledger
 * in three runs — and mission drift is a signal the product reads, so a ledger
 * that grows on its own is a lie about how often the mission changed.
 *
 * The deeper reason is that Mindforge already has an authoritative drift signal
 * and it is not the file: `Mission.applyEdit` diffs `MISSION_CONTENT_FIELDS` and
 * records a revision only when something actually moved. Routing the parsed
 * fields through `UpdateMission` gets the ledger right by construction, and the
 * parsed history stays on the run's result where it is evidence rather than
 * duplicate state.
 */

export interface ReindexInput {
  readonly userId: string;
  readonly missionId: string;
  /** Relative path → bytes, for every file the sync just wrote or left in place. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** Paths the agent deleted, so their rows go too. */
  readonly deleted: readonly string[];
  /** The learner's IANA zone. A record's `Date:` resolves in it, never server-local. */
  readonly timezone: string;
}

/**
 * The lookups a lesson needs to resolve its own `<meta>` tags.
 *
 * Both are keyed by slug and both are populated whether or not this run touched
 * `CURRICULUM.md`, because the run that writes a lesson is normally not the run
 * that wrote the curriculum.
 */
interface Curriculum {
  /** Track slug → id, scoped to this mission. */
  readonly trackIds: ReadonlyMap<string, string>;
  /** Normalised skill slug → id, scoped to the user — skills cross missions. */
  readonly skillIds: ReadonlyMap<string, string>;
}

export interface ReindexResult {
  readonly lessons: number;
  readonly referenceDocs: number;
  readonly records: number;
  readonly resources: number;
  readonly tracks: number;
  readonly skills: number;
  readonly warnings: readonly ParseWarning[];
}

@Injectable()
export class ReindexWorkspace {
  constructor(
    @Inject(WORKSPACE_INDEX_REPOSITORY) private readonly index: WorkspaceIndexRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly missions: UpdateMission,
    private readonly resources: SyncWorkspaceResources,
    private readonly skills: SyncCurriculumSkills,
  ) {}

  async execute(input: ReindexInput): Promise<ReindexResult> {
    const warnings: ParseWarning[] = [];
    const decoder = new TextDecoder();

    // Before lessons, because a lesson resolves its `<meta name="mindforge:track">`
    // against the tracks this call creates. A lesson and the track it belongs to
    // arrive in the same sync — the run that opens a module writes both.
    const curriculum = await this.reindexCurriculum(input, decoder, warnings);

    const lessons = this.readLessons(input, decoder, warnings, curriculum);
    const referenceDocs = this.readReferenceDocs(input, decoder, warnings);
    const records = this.readRecords(input, decoder, warnings, this.clock.now());

    await this.index.saveLessons(input.userId, lessons);
    await this.index.saveReferenceDocs(input.userId, referenceDocs);
    await this.index.saveRecords(input.userId, records);
    await this.index.forgetPaths(input.userId, input.missionId, input.deleted);

    await this.reindexMission(input, decoder, warnings);
    const resources = await this.reindexResources(input, decoder, warnings);

    return {
      lessons: lessons.length,
      referenceDocs: referenceDocs.length,
      records: records.length,
      resources,
      tracks: curriculum.trackIds.size,
      skills: curriculum.skillIds.size,
      warnings,
    };
  }

  /**
   * `CURRICULUM.md` → tracks, their edges, and the skills they intend to build.
   *
   * Skills go through the skills module rather than being written here (§2.1
   * decision 2), and the interface they go through cannot express `score`,
   * `band` or `perceived_level` — a generated curriculum with an opinion about
   * how good somebody is would destroy the calibration gap FR-S5 measures.
   *
   * **Skill *edges* are deliberately not derived from track edges.** The obvious
   * reading is that "track B requires track A" means every skill in B requires
   * every skill in A, and that is wrong twice: it is quadratic in the size of two
   * modules, and §9.4's readiness term is the *fraction* of prerequisites at
   * `working` — so inventing twenty-five edges where the learner meant one
   * pushes a genuinely reachable skill out of their zone of proximal development.
   * Track-level order is what the curriculum knows; skill-level order is not, and
   * pretending otherwise makes the recommender worse rather than better.
   */
  private async reindexCurriculum(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
  ): Promise<Curriculum> {
    const source = input.files.get(CURRICULUM_FILE);

    // A run that did not touch the curriculum must not restructure it. The
    // existing tracks are still read, because the lessons this run *did* write
    // need somewhere to resolve their `<meta>` tag against.
    if (!source) {
      const [trackIds, skillIds] = await Promise.all([
        this.index.trackIdsBySlug(input.userId, input.missionId),
        this.skills.allBySlug(input.userId),
      ]);
      return { trackIds, skillIds };
    }

    const { parsed, warnings: fileWarnings } = parseCurriculum(decoder.decode(source));
    warnings.push(...fileWarnings);

    const { idBySlug: skillIds } = await this.skills.execute({
      userId: input.userId,
      skills: parsed.skills,
    });

    const skillsOf = new Map<string, string[]>();
    for (const skill of parsed.skills) {
      // Through the same normaliser the write used. The file's `Skill slug`
      // column is the learner-facing identity; `skills.slug` is that identity put
      // through the rule the rest of the product forms one by, and looking up the
      // raw value would miss every skill whose slug the normaliser touched.
      const id = skillIds.get(curriculumSkillSlug(skill.skillSlug, skill.name));
      if (id === undefined) continue;
      const bucket = skillsOf.get(skill.trackSlug) ?? [];
      bucket.push(id);
      skillsOf.set(skill.trackSlug, bucket);
    }

    const tracks: IndexedTrack[] = parsed.tracks.map((track): IndexedTrack => ({
      slug: track.slug,
      name: track.name,
      outcome: track.outcome,
      position: track.position,
      prerequisiteSlugs: track.prerequisites,
      skillIds: skillsOf.get(track.slug) ?? [],
    }));

    const trackIds = await this.index.saveTracks(input.userId, input.missionId, tracks);

    return { trackIds, skillIds };
  }

  /**
   * `MISSION.md` → the mission's fields, through the module that owns them.
   *
   * The reason is not written to `mission_revisions` unless something changed,
   * because `applyEdit` decides that — and `reason` is NOT NULL, so a revision it
   * does record needs a sentence. "The agent edited it" is the honest one: the
   * file is what changed, and the agent is who changed it.
   */
  private async reindexMission(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
  ): Promise<void> {
    const source = input.files.get("MISSION.md");
    if (!source) return;

    const { parsed, warnings: missionWarnings } = parseMission(decoder.decode(source));
    warnings.push(...missionWarnings);

    // A topic the parser could not read is not a reason to blank the stored one.
    // The file may be mid-edit, or unfilled, and the mission the learner typed
    // into the app is better than nothing.
    if (parsed.fields.topic === null) return;

    await this.missions.execute(input.userId, input.missionId, {
      topic: parsed.fields.topic,
      why: parsed.fields.why,
      successLooksLike: parsed.fields.successLooksLike,
      constraints: parsed.fields.constraints,
      currentLevel: parsed.fields.currentLevel,
      reason: "Updated by a teach run",
    });
  }

  /**
   * `RESOURCES.md` → the library (FR-T8), through the module that owns it.
   *
   * The upsert key and the columns this may not touch are decided in
   * `SyncWorkspaceResources`, because both are resources decisions rather than
   * teach ones — and because `resources` has no natural unique constraint, so
   * getting it wrong doubles the library on the second run rather than failing.
   */
  private async reindexResources(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
  ): Promise<number> {
    const source = input.files.get("RESOURCES.md");
    if (!source) return 0;

    const { parsed, warnings: fileWarnings } = parseResources(decoder.decode(source));
    warnings.push(...fileWarnings);

    const { created, updated } = await this.resources.execute({
      userId: input.userId,
      missionId: input.missionId,
      primary: parsed.primary,
      rejected: parsed.rejected,
    });

    return created + updated;
  }

  private readLessons(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
    curriculum: Curriculum,
  ): readonly IndexedLesson[] {
    // Keyed by seq rather than collected into a list, because
    // `unique (mission_id, seq)` means two files claiming 0007 is a hard error
    // in Postgres. Two agents, a manual copy, or a `.conflict-` file that slipped
    // the name filter all produce it — and a unique violation must not fail a run
    // that otherwise wrote a good lesson.
    const bySeq = new Map<number, IndexedLesson>();

    for (const [path, bytes] of this.filesIn(input, LESSONS_DIR, /\.html?$/iu)) {
      const filename = path.split("/").pop()!;
      const { parsed, warnings: fileWarnings } = parseLessonHtml(filename, decoder.decode(bytes));
      warnings.push(...fileWarnings);

      // `seq` is NOT NULL. An unnumbered lesson has already produced a
      // `filename_unnumbered` warning; there is no honest number to invent for
      // it, so it is stored in Storage and left out of the index.
      if (parsed.seq === null) continue;

      const existing = bySeq.get(parsed.seq);
      if (existing) {
        warnings.push({
          code: "sequence_mismatch",
          args: { seq: parsed.seq, kept: filename, dropped: existing.storagePath },
        });
      }

      bySeq.set(parsed.seq, {
        missionId: input.missionId,
        seq: parsed.seq,
        slug: parsed.slug,
        title: parsed.title,
        storagePath: path,
        contentHash: sha256(bytes),
        trackId: this.resolveTrack(parsed.trackSlug, curriculum, filename, warnings),
        skillIds: this.resolveSkills(parsed.skillSlugs, curriculum, filename, warnings),
      });
    }

    return [...bySeq.values()];
  }

  /**
   * A lesson's declared track → a row id, or null.
   *
   * Null in three different situations, and only one of them is worth a warning.
   * A lesson that declared nothing is a pre-curriculum or off-plan lesson, which
   * is legal and permanent. A lesson naming a track that does not exist is the
   * interesting case: either the curriculum was regenerated without it, or the
   * agent invented a slug — and both leave a real lesson filed under no module,
   * which is exactly the kind of thing that is invisible until somebody wonders
   * why their module looks short.
   */
  private resolveTrack(
    slug: string | null,
    curriculum: Curriculum,
    filename: string,
    warnings: ParseWarning[],
  ): string | null {
    if (slug === null) return null;

    const id = curriculum.trackIds.get(slug);
    if (id === undefined) {
      warnings.push(warn("value_unknown", { field: "track", value: slug, file: filename }));
      return null;
    }
    return id;
  }

  /**
   * A lesson's declared skills → row ids.
   *
   * Resolved only against skills the curriculum named, never created here. A
   * lesson is allowed to say what it taught; it is not allowed to invent an entry
   * in the graph the product scores from — `lessons.outcome` becomes evidence
   * through this join, and a skill that exists only because one lesson mentioned
   * it would have exactly one possible source of evidence and no way to be wrong.
   */
  private resolveSkills(
    slugs: readonly string[],
    curriculum: Curriculum,
    filename: string,
    warnings: ParseWarning[],
  ): readonly string[] {
    const ids: string[] = [];

    for (const slug of slugs) {
      const id = curriculum.skillIds.get(skillSlug(slug));
      if (id === undefined) {
        warnings.push(warn("value_unknown", { field: "skill", value: slug, file: filename }));
        continue;
      }
      if (!ids.includes(id)) ids.push(id);
    }

    return ids;
  }

  private readReferenceDocs(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
  ): readonly IndexedReferenceDoc[] {
    const docs: IndexedReferenceDoc[] = [];

    for (const [path, bytes] of this.filesIn(input, REFERENCE_DIR, /\.html?$/iu)) {
      const filename = path.split("/").pop()!;
      const { parsed, warnings: fileWarnings } = parseReferenceHtml(
        filename,
        decoder.decode(bytes),
      );
      warnings.push(...fileWarnings);

      docs.push({
        missionId: input.missionId,
        slug: parsed.slug,
        title: parsed.title,
        storagePath: path,
        contentHash: sha256(bytes),
      });
    }

    return docs;
  }

  private readRecords(
    input: ReindexInput,
    decoder: TextDecoder,
    warnings: ParseWarning[],
    now: Date,
  ): readonly IndexedRecord[] {
    const bySeq = new Map<number, IndexedRecord>();

    for (const [path, bytes] of this.filesIn(input, RECORDS_DIR, /\.md$/iu)) {
      const filename = path.split("/").pop()!;
      const { seq, slug } = parseNumberedFilename(filename);
      if (seq === null) {
        warnings.push({ code: "filename_unnumbered", args: { filename } });
        continue;
      }

      const { parsed, warnings: fileWarnings } = parseLearningRecord(decoder.decode(bytes));
      warnings.push(...fileWarnings);

      bySeq.set(seq, {
        missionId: input.missionId,
        seq,
        // NOT NULL, and the filename always has one — which is why the parser
        // returns null rather than inventing a title of its own.
        title: parsed.title ?? deslugify(slug),
        whatLearned: parsed.whatLearned,
        evidence: parsed.evidence,
        keyInsight: parsed.keyInsight,
        struggles: parsed.struggles,
        next: parsed.next,
        storagePath: path,
        contentHash: sha256(bytes),
        recordedAt: resolveInZone(parsed.date, input.timezone, now),
        supersedesSeq: parsed.supersedesSeq,
      });
    }

    return [...bySeq.values()];
  }

  /** Files under `directory`, excluding retained conflict copies. */
  private *filesIn(
    input: ReindexInput,
    directory: string,
    extension: RegExp,
  ): Generator<readonly [string, Uint8Array]> {
    for (const [path, bytes] of input.files) {
      if (!path.startsWith(`${directory}/`)) continue;
      if (!extension.test(path)) continue;
      // A `.conflict-` copy is a retained second version, not a lesson. Its
      // filename parses to a sequence that already exists, so indexing it would
      // collide on `unique (mission_id, seq)` — and the winner would be arbitrary.
      if (isConflictCopy(path)) continue;
      yield [path, bytes] as const;
    }
  }
}

/**
 * `YYYY-MM-DD` → the instant that date began in the learner's zone.
 *
 * Through `packages/core` rather than reimplemented, which is non-negotiable 3 and
 * not ceremony here: `new Date("2026-08-08")` is midnight **UTC**, which for
 * anyone west of Greenwich is the previous day locally — and a learning record
 * that lands a day early belongs to the wrong weekly review. `dayBounds` also
 * handles the case a hand-rolled offset calculation gets wrong, which is a DST
 * gap day where local midnight does not exist.
 *
 * `null` falls back to the run's own moment, because `recorded_at` is NOT NULL
 * and "we could not read the date" is not a reason to lose the record.
 */
function resolveInZone(date: string | null, timezone: string, fallback: Date): Date {
  if (date === null || !isIsoDate(date)) return fallback;
  return dayBounds(date, resolveTimeZone(timezone)).start;
}
