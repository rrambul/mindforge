import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * Resources — books, podcasts, articles, courses (FR-R1..R6).
 *
 * Two product decisions drive the shape. Progress is **type-specific**, because "37%" of a podcast
 * and "page 137 of 590" are not the same claim and flattening both to a percentage throws away the
 * only part you can act on. And abandoning is **first-class and guilt-free** (FR-R5) — the reason is
 * prime friction data, not a confession.
 */

export const RESOURCE_TYPES = [
  "book",
  "podcast",
  "article",
  "video",
  "course",
  "docs",
  "paper",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const ResourceTypeSchema = z.enum(RESOURCE_TYPES);

/**
 * `inbox → queued → active → finished | abandoned | reference` (FR-R5).
 *
 * `inbox` exists because FR-R2 makes capture frictionless: a pasted URL lands somewhere without
 * being triaged, and triage happens later when you have the attention for it. `reference` is the
 * thing you return to rather than finish — a docs site is never "read".
 */
export const RESOURCE_STATUSES = [
  "inbox",
  "queued",
  "active",
  "finished",
  "abandoned",
  "reference",
] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];
export const ResourceStatusSchema = z.enum(RESOURCE_STATUSES);

/** The unit progress is measured in, which follows the type rather than the user's choice. */
export const PROGRESS_UNITS = ["page", "chapter", "percent", "second", "module", "none"] as const;
export type ProgressUnit = (typeof PROGRESS_UNITS)[number];

/**
 * How each type is measured. FR-R1 names these; encoding them here means the UI cannot offer a page
 * number for a podcast.
 */
export const UNIT_FOR_TYPE: Readonly<Record<ResourceType, ProgressUnit>> = {
  book: "page",
  paper: "page",
  course: "module",
  podcast: "second",
  video: "second",
  // An article is read or not; a time-to-read estimate is metadata, not progress.
  article: "none",
  // Reference material is returned to, never completed.
  docs: "none",
};

export const ResourceProgressSchema = z
  .object({
    unit: z.enum(PROGRESS_UNITS),
    current: z.coerce.number().min(0),
    /** Null when unknown — an audiobook whose length you never checked still has a position. */
    total: z.coerce.number().min(1).nullable().optional(),
  })
  .refine((p) => p.total == null || p.current <= p.total, {
    error: "Progress cannot exceed the total",
    path: ["current"],
  });

export type ResourceProgress = z.infer<typeof ResourceProgressSchema>;

const title = z.string().trim().min(1).max(300);

/**
 * FR-R2's make-or-break path: paste a URL and let the server fill the rest.
 *
 * Only the URL is required. Everything else is a correction to what metadata extraction guessed —
 * which is why the capture endpoint accepts the same optional fields rather than forcing a second
 * request to fix a wrong title.
 */
export const CaptureResourceSchema = z.object({
  id: UuidSchema.optional(),
  url: z.url(),
  title: title.optional(),
  author: z.string().trim().max(200).nullable().optional(),
  type: ResourceTypeSchema.optional(),
  missionId: UuidSchema.nullable().optional(),
});
export type CaptureResourceInput = z.infer<typeof CaptureResourceSchema>;

/** Adding something with no URL — a paper book, a course you are enrolled in. */
export const CreateResourceSchema = z.object({
  id: UuidSchema.optional(),
  type: ResourceTypeSchema,
  title,
  author: z.string().trim().max(200).nullable().optional(),
  url: z.url().nullable().optional(),
  status: ResourceStatusSchema.default("inbox"),
  missionId: UuidSchema.nullable().optional(),
});
export type CreateResourceInput = z.infer<typeof CreateResourceSchema>;

/**
 * What a resource is connected to (`resource_links`).
 *
 * A *replacement* of the whole set rather than add/remove endpoints: the operation is then idempotent,
 * a retry cannot double-link, and the client sends the state it wants rather than a diff it computed
 * from a list that may have moved. Both arrays default to empty, so sending `{}` unlinks everything —
 * which is the honest reading of "these are the links".
 *
 * Bounded because a resource connected to twenty missions is not connected to anything: FR-R3's point
 * is that an article you never tie to a goal is entertainment, and a link to everything says as little
 * as a link to nothing.
 */
export const SetResourceLinksSchema = z.object({
  missionIds: z.array(UuidSchema).max(20).default([]),
  skillIds: z.array(UuidSchema).max(20).default([]),
});
export type SetResourceLinksInput = z.infer<typeof SetResourceLinksSchema>;

export const UpdateResourceSchema = z
  .object({
    title: title.optional(),
    author: z.string().trim().max(200).nullable().optional(),
    type: ResourceTypeSchema.optional(),
    status: ResourceStatusSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: "Provide at least one field to change",
    path: ["title"],
  });
export type UpdateResourceInput = z.infer<typeof UpdateResourceSchema>;

/**
 * A capture path: you mark a page as you close the book (§5.1), so it takes only the position.
 */
export const UpdateProgressSchema = z.object({
  current: z.coerce.number().min(0),
  total: z.coerce.number().min(1).nullable().optional(),
});
export type UpdateProgressInput = z.infer<typeof UpdateProgressSchema>;

/**
 * FR-R5 — abandoning is first-class and the reason is optional.
 *
 * Optional deliberately: requiring a justification to stop reading something turns quitting into a
 * confession, and the predictable result is items that sit in `active` forever, which is worse data
 * than an abandonment with no reason.
 */
export const AbandonResourceSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});
export type AbandonResourceInput = z.infer<typeof AbandonResourceSchema>;

export const ListResourcesQuerySchema = z.object({
  status: ResourceStatusSchema.optional(),
  type: ResourceTypeSchema.optional(),
  missionId: UuidSchema.optional(),
});
export type ListResourcesQuery = z.infer<typeof ListResourcesQuerySchema>;

/** Presentation order: what you are reading, then what is queued, then the rest. */
export const RESOURCE_STATUS_ORDER: readonly ResourceStatus[] = [
  "active",
  "inbox",
  "queued",
  "reference",
  "finished",
  "abandoned",
];

export function resourceStatusRank(status: ResourceStatus): number {
  return RESOURCE_STATUS_ORDER.indexOf(status);
}

/**
 * A progress fraction, or null when it cannot be computed.
 *
 * Null rather than 0 when the total is unknown, for the same reason a skill with no evidence scores
 * null: "I am 137 pages in of an unknown length" and "I have made no progress" are different claims,
 * and rendering the first as 0% would be the app inventing a number.
 */
export function progressFraction(progress: ResourceProgress | null): number | null {
  if (progress === null || progress.total == null || progress.total === 0) return null;
  return Math.min(1, progress.current / progress.total);
}

/** The starting progress for a type, so a captured resource is immediately markable. */
export function initialProgress(type: ResourceType): ResourceProgress {
  return { unit: UNIT_FOR_TYPE[type], current: 0, total: null };
}

/**
 * Guessed from the URL, so a paste does not have to be typed.
 *
 * Deliberately crude and deliberately not a model call — M1's bullet says server-side extraction with
 * no model, and a wrong guess costs one tap to correct while a model call costs money and latency on
 * the product's most-used path.
 */
export function guessTypeFromUrl(url: string): ResourceType {
  // Parsed with a regex rather than `new URL`, because `URL` is a host global: declaring it would
  // mean adding DOM types to this package, and packages/core is shared by a Node API and a browser
  // bundle — it must not assume either. Crude is also fine here by design.
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url.trim());
  if (!match) return "article";

  const host = (match[1] ?? "")
    .toLowerCase()
    // Strip userinfo and port, which are not part of the host for matching purposes.
    .replace(/^[^@]*@/, "")
    .replace(/:\d+$/, "");
  const path = (match[2] ?? "").toLowerCase();

  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(host)) return "video";
  if (/(^|\.)(spotify\.com|podcasts\.apple\.com|overcast\.fm|pca\.st)$/.test(host))
    return "podcast";
  if (
    /(^|\.)(arxiv\.org|dl\.acm\.org|ieeexplore\.ieee\.org)$/.test(host) ||
    path.endsWith(".pdf")
  ) {
    return "paper";
  }
  if (/(^|\.)(coursera\.org|udemy\.com|egghead\.io|frontendmasters\.com)$/.test(host))
    return "course";
  if (/^docs?\./.test(host) || /(^|\/)(docs|documentation|reference)(\/|$)/.test(path))
    return "docs";
  return "article";
}
