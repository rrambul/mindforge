import type { FrictionType } from "@mindforge/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useRunningSession, useStopSession } from "../features/focus/api/use-focus.js";
import { frictionBody, useLogFriction } from "../features/friction/api/use-friction.js";
import { captureBody, useCaptureResource } from "../features/resources/api/use-resources.js";
import { ActionsProvider, type Action } from "../shared/lib/action-registry.js";
import { CommandSurface } from "../shared/ui/CommandSurface.js";
import { NAV_ROUTES } from "./router.js";

/**
 * Assembles the action registry and owns the command surface.
 *
 * It lives in `app/` because it reaches into focus, friction, resources, and navigation at once —
 * §2.2 rule 6 puts cross-feature composition here, and this is the most cross-feature thing in the app.
 *
 * NORTHSTAR names three actions for the palette: start focus, log friction, add resource. Navigation is
 * here too, because a keyboard user's first instinct is to type a screen's name, and a palette that
 * answers "start focus" but not "goals" feels broken rather than focused.
 */
export function CommandActions({ children }: { readonly children: ReactNode }) {
  // `useNavigate`, not a callback from the shell. The prop version needed its own copy of the screen
  // union and its own copy of the list below, so widening one and not the others put a screen in the
  // bar and left it out of the palette — which is exactly what happened.
  const navigate = useNavigate();
  const { t } = useTranslation("command");
  const { t: nav } = useTranslation("common");
  // The friction vocabulary lives in its own namespace, translated once and read here rather than
  // copied — the chips render the same words (§5.2).
  const { t: friction } = useTranslation("friction");

  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const running = useRunningSession(true);
  const stop = useStopSession();
  const logFriction = useLogFriction();
  const capture = useCaptureResource();

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
      ...FRICTION_SHORTCUTS.map<Action>((type) => ({
        id: `friction-${type}`,
        label: t("action.logFriction", { type: friction(`type.${type}`) }),
        group: t("group.capture"),
        keywords: ["friction", "annoyed", "stuck", "blocked", type],
        // Friction can be logged without a session — FR-C2's whole point is that it is never gated on
        // remembering to start a timer.
        run: () => logFriction.mutate(frictionBody(type, runningId)),
      })),
      {
        id: "capture-url",
        label: t("action.captureUrl"),
        group: t("group.capture"),
        keywords: ["resource", "link", "article", "paste", "read"],
        // Reads the clipboard because that is what makes this one keystroke instead of a form. Falls
        // back to the library screen when the browser refuses, rather than failing silently.
        run: () => {
          void navigator.clipboard
            ?.readText()
            .then((text) => {
              const url = text.trim();
              if (/^https?:\/\/\S+$/i.test(url)) capture.mutate(captureBody({ url }));
              else void navigate({ to: "/library" });
            })
            .catch(() => void navigate({ to: "/library" }));
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
  }, [t, nav, friction, runningId, stop, logFriction, capture, navigate]);

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

/**
 * The friction types worth a palette entry.
 *
 * The same ranked four as the chips (§5.3), minus the ranking: the palette is searched by name, so
 * ordering by usage buys nothing, and putting all eleven in would bury every other action under them.
 * `productive_struggle` is here for the reason it is pinned on the chips — nobody volunteers "this was
 * hard in a good way" unless it is in front of them.
 */
const FRICTION_SHORTCUTS: readonly FrictionType[] = [
  "self_interruption",
  "tooling",
  "too_hard",
  "productive_struggle",
];
