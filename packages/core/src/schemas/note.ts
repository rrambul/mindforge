import { z } from "zod";
import { UuidSchema } from "./common.js";

/**
 * Notes (§6.14, FR-N1..N8).
 *
 * The design decision that keeps this from becoming the note-taking app in the non-goals: notes are
 * **inputs to the system, not an archive**. No backlinks, no wikilinks, no graph view, no daily
 * notes. A note exists to be read by lesson generation (FR-N5) and promoted to a review item
 * (FR-N4), and every feature that would make it an end in itself is deliberately absent.
 */

/**
 * What a note can hang off. `standalone` is the escape hatch for the genuinely unfiled thought —
 * without it, the ≤5s budget breaks the moment you have something to write and nowhere to put it.
 */
export const NOTE_SUBJECTS = [
  "mission",
  "goal",
  "skill",
  "resource",
  "lesson",
  "reference_doc",
  "learning_record",
  "focus_session",
  "assessment",
  "artifact",
  "standalone",
] as const;

export type NoteSubject = (typeof NOTE_SUBJECTS)[number];
export const NoteSubjectSchema = z.enum(NOTE_SUBJECTS);

/**
 * Stemming follows the language of the **content**, not the UI locale (FR-L4).
 *
 * A note written in Portuguese needs the Portuguese stemmer regardless of what the interface is
 * showing — and for this user in particular, a pt-BR interface with English notes is likely. These
 * are Postgres `regconfig` names because the generated `search` column casts them directly.
 */
export const NOTE_LANGUAGES = ["english", "portuguese"] as const;
export type NoteLanguage = (typeof NOTE_LANGUAGES)[number];
export const NoteLanguageSchema = z.enum(NOTE_LANGUAGES);

/**
 * A highlight is a note with a quote and a locator — one concept, not two features (FR-N2).
 *
 * `{"page":204}` for a book, `{"seconds":1420}` for a podcast, `{"selector":"#h3"}` for a lesson.
 * Loose on purpose: the shape is type-specific, and a discriminated union here would have to be
 * extended for every resource type the product gains.
 */
export const NoteLocatorSchema = z
  .object({
    page: z.coerce.number().int().min(1).optional(),
    seconds: z.coerce.number().int().min(0).optional(),
    selector: z.string().min(1).max(200).optional(),
  })
  .refine((locator) => Object.values(locator).some((value) => value !== undefined), {
    error: "A locator needs at least one of page, seconds, or selector",
  });

export type NoteLocator = z.infer<typeof NoteLocatorSchema>;

const body = z.string().trim().min(1).max(20_000);

/**
 * One tap from a running session (FR-N3), which is why so little is required.
 *
 * `subjectType` defaults to `standalone` so a note can be captured with nothing but text — the
 * subject is something the *caller* knows (the route knows a session is running), never something
 * the writer is asked to pick. §6.14: "No picker, no filing."
 */
export const CreateNoteSchema = z
  .object({
    id: UuidSchema.optional(),
    body,
    subjectType: NoteSubjectSchema.default("standalone"),
    subjectId: UuidSchema.nullable().optional(),
    quote: z.string().trim().max(4_000).nullable().optional(),
    locator: NoteLocatorSchema.nullable().optional(),
    /**
     * Left optional rather than defaulted.
     *
     * A default made "omitted" and "deliberately English" the same value, and the server treats the
     * first as "derive it from my profile" — so an English note written by someone whose content
     * language is pt-BR was stored and indexed as Portuguese, which is FR-L4 inverted.
     */
    lang: NoteLanguageSchema.optional(),
    pinned: z.boolean().default(false),
  })
  .refine((note) => note.subjectType === "standalone" || note.subjectId != null, {
    error: "A note attached to something needs that thing's id",
    path: ["subjectId"],
  });

export type CreateNoteInput = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z
  .object({
    body: body.optional(),
    quote: z.string().trim().max(4_000).nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: "Provide at least one field to change",
    path: ["body"],
  });

export type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>;

/** FR-N6: full-text search across all notes is the entire retrieval story. */
export const ListNotesQuerySchema = z.object({
  subjectType: NoteSubjectSchema.optional(),
  subjectId: UuidSchema.optional(),
  /** Matched against the generated tsvector, stemmed by each note's own language. */
  q: z.string().trim().min(1).max(200).optional(),
  pinned: z.stringbool().optional(),
});

export type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>;

/**
 * Which Postgres text-search configuration to stem a note with, from the content language.
 *
 * Derived rather than asked: the writer should not have to declare a language, and the content
 * language the profile already stores is the best available guess (§5.2's third axis).
 */
export function noteLanguageFor(contentLanguage: string): NoteLanguage {
  return contentLanguage.toLowerCase().startsWith("pt") ? "portuguese" : "english";
}
