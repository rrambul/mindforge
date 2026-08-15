import { z } from "zod";

/**
 * The mission contract — one definition, three consumers.
 *
 * The API validates with these, the SPA's forms resolve against them, and the
 * teach agent's structured outputs will too (TECH-DESIGN.md §2.2 rule 3). A field
 * cannot drift between what the server accepts and what the form collects,
 * because there is only one place to change it.
 */

/**
 * Keys, not display text. The UI translates at render (§5.2), so `parked` is a
 * stable contract rather than copy.
 */
export const MISSION_STATUSES = ["active", "parked", "completed", "abandoned"] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const MissionStatusSchema = z.enum(MISSION_STATUSES);

/**
 * Presentation order: what you are working on, then what you set aside, then what
 * is over.
 *
 * Explicit because `status` is a text column and sorting it in SQL gives
 * *alphabetical* order — `abandoned, active, completed, parked` — which puts
 * abandoned missions above active ones on the screen whose entire job is to get you
 * into a focus session. That reads as correct today only because `completed` and
 * `abandoned` are not yet reachable.
 *
 * Shared with the SPA so an optimistic insert lands in the same place the server
 * would have put it.
 */
export const MISSION_STATUS_ORDER: readonly MissionStatus[] = [
  "active",
  "parked",
  "completed",
  "abandoned",
];

export function missionStatusRank(status: MissionStatus): number {
  return MISSION_STATUS_ORDER.indexOf(status);
}

/**
 * FR-M3. Scatter is the main failure mode of ambitious learners, so this is a
 * product rule rather than a preference — and it lives here so the SPA can
 * disable "new mission" *before* a submit fails, rather than surfacing a 409.
 *
 * It was 3 until 2026-08-15, which is the number that argues the rule. 10 is a
 * runaway guard, not a limit that shapes behaviour: nobody with ten live missions
 * is being protected from scatter by the eleventh being refused. Raised at the
 * owner's request to author several missions at once; the honest way back is to
 * make it per-user configurable with 3 as the default, as FR-M3 always implied,
 * and then this constant becomes the fallback and nothing else moves.
 */
export const MISSION_WIP_LIMIT = 10;

/** Long-form fields are desktop-authored (§5.1), so the ceilings are generous. */
const TOPIC_MAX = 200;
const PROSE_MAX = 4_000;

const topic = z
  .string()
  // Trimmed before validation, or "   " passes a min(3) check and stores as blank.
  .trim()
  .min(3)
  .max(TOPIC_MAX);

/**
 * `.nullable()` is the "clear this field" signal and `undefined` means "leave it
 * alone". Keeping them distinct is what makes PATCH able to erase a `why` without
 * a separate endpoint — collapsing them would make an omitted field indistinguishable
 * from a cleared one.
 */
const prose = z.string().trim().max(PROSE_MAX).nullable();

/** Empty prose is stored as null, so "" and null cannot both mean "absent". */
const normalizedProse = prose.transform((value) => (value === null || value === "" ? null : value));

/**
 * Same shape as `teach`'s MISSION.md so the two can round-trip (FR-M1, FR-T1).
 */
export const MissionFieldsSchema = z.object({
  topic,
  why: normalizedProse,
  successLooksLike: normalizedProse,
  constraints: normalizedProse,
  currentLevel: normalizedProse,
});

export type MissionFields = z.infer<typeof MissionFieldsSchema>;

/** The prose fields default to absent; only the topic is genuinely required. */
export const CreateMissionSchema = z.object({
  topic,
  why: normalizedProse.default(null),
  successLooksLike: normalizedProse.default(null),
  constraints: normalizedProse.default(null),
  currentLevel: normalizedProse.default(null),
});

export type CreateMissionInput = z.infer<typeof CreateMissionSchema>;

/**
 * What a form holds *before* defaults and transforms run — the prose fields are still
 * optional and still possibly `""`.
 *
 * Distinct from `CreateMissionInput` because `.default()` and `.transform()` make the
 * schema's input and output genuinely different types, and react-hook-form needs the
 * input one. Exported so the SPA does not have to reach for `z.input` itself, which
 * would put a zod type in a component signature.
 */
export type CreateMissionFormValues = z.input<typeof CreateMissionSchema>;

/**
 * PATCH: every field optional, but a body that changes nothing is a mistake worth
 * reporting rather than a no-op to absorb.
 *
 * `reason` answers FR-M2's "why it changed". It is optional on purpose — mission
 * editing is long-form desktop work, but blocking an edit on a justification
 * would train you to type "update" forever, which is worse than no reason at all.
 * What changed and when is recorded either way; that is the drift signal.
 */
export const UpdateMissionSchema = z
  .object({
    topic: topic.optional(),
    why: normalizedProse.optional(),
    successLooksLike: normalizedProse.optional(),
    constraints: normalizedProse.optional(),
    currentLevel: normalizedProse.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (body) =>
      Object.keys(body).some(
        (key) => key !== "reason" && body[key as keyof typeof body] !== undefined,
      ),
    { error: "Provide at least one field to change", path: ["topic"] },
  );

export type UpdateMissionInput = z.infer<typeof UpdateMissionSchema>;

export const ListMissionsQuerySchema = z.object({
  status: MissionStatusSchema.optional(),
});

export type ListMissionsQuery = z.infer<typeof ListMissionsQuerySchema>;

/** Which fields count as drift. Status is tracked separately and is not drift. */
export const MISSION_CONTENT_FIELDS = [
  "topic",
  "why",
  "successLooksLike",
  "constraints",
  "currentLevel",
] as const satisfies readonly (keyof MissionFields)[];

export type MissionContentField = (typeof MISSION_CONTENT_FIELDS)[number];
