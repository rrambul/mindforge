import { z } from "zod";
import { BANDS } from "../scoring/bands.js";
import { UuidSchema } from "./common.js";

/**
 * Skills (FR-S1..S6).
 *
 * What is *not* here is the point: there is no `score` field on any input schema. A score comes from
 * evidence (FR-S2) and nothing else, so no client can send one — while `perceivedLevel` is accepted
 * freely, kept in its own column, and never allowed to move it. The gap between the two is the
 * calibration metric (FR-S5), which only means anything while the two stay independent.
 */

export const CreateSkillSchema = z.object({
  id: UuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2_000).optional(),
  /**
   * The self-rating, optional at creation.
   *
   * 0–100 rather than a band, because the gap is arithmetic and bands are five buckets — "I'd say 70"
   * carries information that "Fluent" rounds away.
   */
  perceivedLevel: z.coerce.number().min(0).max(100).optional(),
  /** Prerequisites can be declared as the skill is added, which is when they are most obvious. */
  prerequisiteIds: z.array(UuidSchema).max(20).default([]),
});
export type CreateSkillInput = z.infer<typeof CreateSkillSchema>;

export const UpdateSkillSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(2_000).nullable().optional(),
    perceivedLevel: z.coerce.number().min(0).max(100).nullable().optional(),
    /**
     * The half-life for decay (FR-S4), in days.
     *
     * Adjustable because skills genuinely differ — a language you speak daily fades slower than a
     * library API — and bounded so it cannot be set to "never", which would be a way to switch decay
     * off and quietly make the dashboard flatter.
     */
    halfLifeDays: z.coerce.number().min(7).max(730).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must change",
  });
export type UpdateSkillInput = z.infer<typeof UpdateSkillSchema>;

/** A self-rating on its own, because it is the one thing a user updates often (FR-S5). */
export const RateSkillSchema = z.object({
  perceivedLevel: z.coerce.number().min(0).max(100),
});
export type RateSkillInput = z.infer<typeof RateSkillSchema>;

export const AddPrerequisiteSchema = z.object({
  prereqId: UuidSchema,
});
export type AddPrerequisiteInput = z.infer<typeof AddPrerequisiteSchema>;

export const ListSkillsQuerySchema = z.object({
  band: z.enum(BANDS).optional(),
  /** Skills whose self-rating runs ahead of the evidence — the list worth looking at (FR-S5). */
  overconfidentOnly: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .transform((value) => value === true || value === "true")
    .optional(),
});
export type ListSkillsQuery = z.infer<typeof ListSkillsQuerySchema>;

/**
 * A URL-safe, stable identifier from a name.
 *
 * Stored alongside the name so a rename does not break a link, and unique per user. Deliberately not
 * a transliteration library: "programação" becoming `programacao` is worth the accents being folded,
 * and pulling in a dependency to get "программирование" right would be solving a problem this user
 * does not have.
 */
export function skillSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    // Combining marks, so `ç` becomes `c` rather than being dropped entirely.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, "");

  // A name made entirely of characters this drops — "日本語", "!!!" — would otherwise produce an empty
  // slug and a unique-constraint collision on the second one.
  return slug === "" ? "skill" : slug;
}
