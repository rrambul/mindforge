import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * One thing the user can do, from anywhere.
 *
 * The registry exists because §5.1 asks for the **same actions on two surfaces**: a command palette on
 * desktop and a bottom sheet on mobile. Two lists would drift, and the one that drifted would be the
 * mobile one — which is the surface the capture budget actually depends on.
 */
export interface Action {
  readonly id: string;
  /** Already translated. The registry stores no keys, because the caller knows its own namespace. */
  readonly label: string;
  /** Which heading it appears under, already translated. */
  readonly group: string;
  /**
   * Extra words that should match this action.
   *
   * "log friction" should be findable by typing "annoyed" or "interrupt" — the label alone assumes the
   * user knows the app's vocabulary, which on the surface designed for speed is the wrong assumption.
   */
  readonly keywords?: readonly string[];
  readonly run: () => void;
  /**
   * Present and unavailable, rather than absent.
   *
   * "Stop focus" with nothing running should be *visible and disabled* with a reason: an action that
   * vanishes teaches that the palette is unreliable, and the user retypes it looking for a typo.
   */
  readonly unavailableReason?: string | undefined;
}

interface ActionRegistry {
  readonly actions: readonly Action[];
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: boolean;
}

const ActionsContext = createContext<ActionRegistry | null>(null);

export function ActionsProvider({
  actions,
  isOpen,
  open,
  close,
  children,
}: {
  readonly actions: readonly Action[];
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly children: ReactNode;
}) {
  const value = useMemo<ActionRegistry>(
    () => ({ actions, isOpen, open, close }),
    [actions, isOpen, open, close],
  );

  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

/**
 * Null outside a provider rather than throwing.
 *
 * A test rendering one screen in isolation should not have to stand up the whole action registry to do
 * it, and a component that only *offers* the palette can do without it.
 */
export function useActions(): ActionRegistry | null {
  return useContext(ActionsContext);
}

/**
 * Ranked matches for what the user typed.
 *
 * A prefix match on the label ranks above a word-start match, which ranks above anything found only
 * through a keyword — so typing "st" puts "Start focus" first rather than whatever happens to be
 * alphabetically lucky. Unavailable actions sort last: they are worth showing, and not worth showing
 * first.
 *
 * Deliberately not fuzzy. Fuzzy matching on a list this small mostly produces surprising order, and
 * the palette's value is that the first result is predictable enough to hit Enter without reading.
 */
export function matchActions(actions: readonly Action[], query: string): Action[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...actions].sort(byAvailability);
  }

  const scored = actions
    .map((action) => ({ action, score: scoreAction(action, needle) }))
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => {
    const availability = byAvailability(a.action, b.action);
    if (availability !== 0) return availability;
    return b.score - a.score;
  });

  return scored.map((entry) => entry.action);
}

function byAvailability(a: Action, b: Action): number {
  return Number(a.unavailableReason !== undefined) - Number(b.unavailableReason !== undefined);
}

function scoreAction(action: Action, needle: string): number {
  const label = action.label.toLowerCase();

  if (label.startsWith(needle)) return 100;
  // A word start, so "focus" finds "Start focus" — the most common way people search a palette.
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 80;
  if (label.includes(needle)) return 60;

  for (const keyword of action.keywords ?? []) {
    const lower = keyword.toLowerCase();
    if (lower.startsWith(needle)) return 40;
    if (lower.includes(needle)) return 20;
  }

  return 0;
}
