/**
 * Where the guided first mission left off.
 *
 * §5.3 asks for it to be "skippable at any point, resumable from a banner", which means the position
 * has to outlive a reload. Kept in `localStorage` rather than on the server: it is a fact about this
 * browser's onboarding, not about the account, and a column for it would still be there in five years
 * describing something that happened once.
 *
 * The ids of what has been created so far are part of the state, because each step *builds on the last*
 * — the goal hangs off the mission, the session runs against it. Losing them mid-way would mean a
 * resumed tour creating a second mission, which is exactly the demo-data mess §5.3 rules out.
 */

const STORAGE_KEY = "mindforge.first-run";

export const FIRST_RUN_STEPS = ["mission", "goal", "resource", "focus", "done"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];

export interface FirstRunState {
  readonly step: FirstRunStep;
  readonly missionId?: string;
  readonly goalId?: string;
  readonly resourceId?: string;
  /** Set when the user says "not now". Distinct from finishing. */
  readonly dismissed?: boolean;
}

const EMPTY: FirstRunState = { step: "mission" };

/**
 * Reads the stored state, tolerating anything.
 *
 * A corrupt value means a fresh start rather than a crash on boot: this runs before the app renders,
 * and a thrown parse error in onboarding state would take the whole app with it — over something that
 * does not matter.
 */
export function readFirstRun(storage: Pick<Storage, "getItem"> = localStorage): FirstRunState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;

    const record = parsed as Record<string, unknown>;
    const step = record["step"];

    return {
      // An unknown step — written by a newer version, then downgraded — restarts rather than rendering
      // a step this build does not have.
      step: isStep(step) ? step : "mission",
      ...(typeof record["missionId"] === "string" ? { missionId: record["missionId"] } : {}),
      ...(typeof record["goalId"] === "string" ? { goalId: record["goalId"] } : {}),
      ...(typeof record["resourceId"] === "string" ? { resourceId: record["resourceId"] } : {}),
      ...(record["dismissed"] === true ? { dismissed: true } : {}),
    };
  } catch {
    return EMPTY;
  }
}

export function writeFirstRun(
  state: FirstRunState,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or disabled storage must not break the tour. The worst case is that a reload restarts it,
    // which is a far better failure than an exception on every keystroke.
  }
}

export function clearFirstRun(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

function isStep(value: unknown): value is FirstRunStep {
  return typeof value === "string" && (FIRST_RUN_STEPS as readonly string[]).includes(value);
}

/** 1-based, for display. `done` reports 4, because there is no fifth step to be on. */
export function stepNumber(step: FirstRunStep): number {
  const index = FIRST_RUN_STEPS.indexOf(step);
  return Math.min(index + 1, 4);
}

/**
 * Whether the banner should offer the tour.
 *
 * Offered when the account is genuinely empty and the user has not said no. "Empty" is decided from
 * real data rather than from a flag, so someone who deletes everything gets the offer again — and
 * someone who created a mission by hand is never nagged to be shown how.
 */
export function shouldOfferFirstRun(state: FirstRunState, missionCount: number): boolean {
  if (state.dismissed === true) return false;
  if (state.step === "done") return false;
  // Mid-tour: the mission exists, so a count of one is not a reason to stop offering to resume.
  if (state.missionId !== undefined) return true;
  return missionCount === 0;
}
