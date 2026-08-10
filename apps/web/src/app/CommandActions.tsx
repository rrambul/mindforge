import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRunningSession, useStopSession } from "../features/focus/api/use-focus.js";
import { ActionsProvider, type Action } from "../shared/lib/action-registry.js";
import { CommandSurface } from "../shared/ui/CommandSurface.js";
import { NAV_ROUTES } from "./router.js";

/**
 * Assembles the action registry and owns the command surface.
 *
 * It lives in `app/` because it reaches into focus and navigation at once — §2.2 rule 6 puts
 * cross-feature composition here. Navigation is here because a keyboard user's first instinct is to
 * type a screen's name, and a palette that answers "stop focus" but not "missions" feels broken
 * rather than focused.
 */
export function CommandActions({ children }: { readonly children: ReactNode }) {
  // `useNavigate`, not a callback from the shell. The prop version needed its own copy of the screen
  // union and its own copy of the list below, so widening one and not the others put a screen in the
  // bar and left it out of the palette — which is exactly what happened.
  const navigate = useNavigate();
  const { t } = useTranslation("command");
  const { t: nav } = useTranslation("common");

  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const running = useRunningSession(true);
  const stop = useStopSession();

  const runningId = running.data?.session?.id ?? null;

  /**
   * ⌘K on macOS, Ctrl+K elsewhere.
   *
   * Bound on `keydown` at the document, and `preventDefault` matters: Firefox focuses the search bar on
   * Ctrl+K and Chrome opens the address bar on ⌘K, so without it the palette opens *and* the browser
   * steals the keystroke.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() !== "k") return;
      if (!event.metaKey && !event.ctrlKey) return;

      event.preventDefault();
      setIsOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const actions = useMemo<Action[]>(() => {
    const capturing: Action[] = [
      {
        id: "stop-focus",
        label: t("action.stopFocus"),
        group: t("group.capture"),
        keywords: ["focus", "timer", "end", "done"],
        // Present and disabled rather than absent. An action that vanishes teaches that the palette is
        // unreliable, and the user retypes it looking for a typo.
        unavailableReason: runningId === null ? t("unavailable.noSession") : undefined,
        run: () => {
          if (runningId !== null) stop.mutate({ id: runningId });
        },
      },
    ];

    // Read from the same table the nav bar renders, so the two cannot disagree about which screens
    // exist.
    const going: Action[] = NAV_ROUTES.map((route) => ({
      id: `go-${route.path}`,
      label: t("action.goTo", { screen: nav(route.labelKey) }),
      group: t("group.go"),
      keywords: [route.path, nav(route.labelKey)],
      run: () => void navigate({ to: route.path }),
    }));

    return [...capturing, ...going];
  }, [t, nav, runningId, stop, navigate]);

  return (
    <ActionsProvider actions={actions} isOpen={isOpen} open={open} close={close}>
      {children}
      <CommandSurface
        actions={actions}
        isOpen={isOpen}
        onClose={close}
        labels={{ title: t("title"), search: t("search"), empty: t("empty") }}
      />
    </ActionsProvider>
  );
}
