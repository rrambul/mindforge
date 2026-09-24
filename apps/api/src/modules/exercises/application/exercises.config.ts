export const EXERCISES_CONFIG = Symbol("ExercisesConfig");

export interface ExercisesConfig {
  /** The runner page on the lessons origin (`apps/lessons`, `/runner`). */
  readonly runnerUrl: string;
  /** The Python runner (`/runner/python`): the only page with `connect-src 'self'`. */
  readonly pythonRunnerUrl: string;
}
