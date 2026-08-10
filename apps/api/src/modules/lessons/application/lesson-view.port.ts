export const LESSON_VIEW_CONFIG = Symbol("LessonViewConfig");

/**
 * What minting a view grant needs, as a token of its own.
 *
 * Not the whole `Env`, for the reason `MEMORY_STORAGE_CONFIG` gives: this module's
 * providers should depend on the two values they use, not on an env object whose
 * shape differs between the API and the worker.
 *
 * The secret is shared with `apps/lessons`, which verifies what this signs. It is
 * a credential in its own right — anyone holding it can read any workspace by
 * signing its prefix — so it lives in the environment and never in a response.
 */
export interface LessonViewConfig {
  /** Origin of the lessons service. **Must** be a different host from the app. */
  readonly lessonsOrigin: string;
  readonly tokenSecret: string;
}
