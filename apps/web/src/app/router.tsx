import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useParams,
  type AnyRoute,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { CurriculumScreen } from "./CurriculumScreen.js";
import { InsightsScreen } from "./InsightsScreen.js";
import { LessonScreen } from "./LessonScreen.js";
import { LibraryScreen } from "./LibraryScreen.js";
import { MissionsScreen } from "./MissionsScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { Shell } from "./Shell.js";
import { TodayScreen } from "./TodayScreen.js";

/**
 * The route tree.
 *
 * **Signed out is not a route.** `/` renders the sign-in form when there is no session, rather than
 * redirecting to `/sign-in`. Two reasons: the session is read asynchronously from storage, so a
 * redirect on "not yet known" flashes the form on every reload — the bug `apps/web/e2e/README.md`
 * already records as untested — and a redirect loses the URL you were trying to reach. Rendering in
 * place keeps the address bar pointing where you asked to go, so signing in lands you there.
 *
 * **Code-based, not file-based.** File-based routing needs a bundler plugin and a generated tree
 * checked into the repo; this is four routes in one readable file, and a generated artifact is a
 * thing to keep in sync for no gain at this size.
 */

/** What every route can reach without prop-drilling through the shell. */
export interface RouterContext {
  readonly signedIn: boolean;
  /** IANA, from the profile. Every "week" a route resolves derives from it (§5.2). */
  readonly timezone: string;
  /** 0 = Sunday. Owned by the user, never re-derived from locale at render (FR-L4). */
  readonly weekStartsOn: 0 | 1;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  // The shell renders the bar and an `Outlet`, so it is the root's component rather than something
  // wrapped around `RouterProvider` — the outlet has to be *inside* the chrome.
  component: Shell,
});

function screen(path: string, component: () => ReactElement): AnyRoute {
  return createRoute({ getParentRoute: () => rootRoute, path, component });
}

export const todayRoute = screen("/", TodayScreen);
export const missionsRoute = screen("/missions", MissionsScreen);
/**
 * The one route with a parameter, and the only screen not in the nav: a curriculum
 * belongs to a mission, so it is reached from that mission's card rather than from
 * a bar item that would have to guess which mission you meant (FR-K5).
 *
 * The id is read here and handed down as a prop rather than read inside the
 * screen. `router.tsx` imports every screen, so a screen that asked for its own
 * params would depend on the `Register` augmentation at the bottom of this file,
 * which depends on the tree that contains that screen — a cycle TypeScript breaks
 * by widening the id to `any`, silently, on the way into a query key.
 */
function CurriculumRouteScreen(): ReactElement {
  return (
    <CurriculumScreen
      missionId={pathParam(useParams({ from: "/missions/$missionId" }), "missionId")}
    />
  );
}

/**
 * One named segment of the current path, as a string.
 *
 * Narrowed from `unknown` rather than read off the hook's return type, because
 * that type is the casualty of the cycle described above and is `any` — and an
 * `any` that reaches a query key is a cache entry keyed on nothing.
 */
function pathParam(params: unknown, name: string): string {
  if (typeof params !== "object" || params === null) return "";
  const value = (params as Record<string, unknown>)[name];
  return typeof value === "string" ? value : "";
}

export const curriculumRoute = screen("/missions/$missionId", CurriculumRouteScreen);

/**
 * The reader (FR-T5) and the library (FR-T6), both below a mission for the same
 * reason the curriculum is: neither means anything without one, and both are
 * reached from it rather than from the nav.
 *
 * A lesson carries its mission in the URL even though `/lessons/$lessonId` would
 * resolve — the back link, the "next lesson" lookup and the records panel all need
 * the mission, and reading it from the loaded lesson would leave the whole page
 * waiting on one request to know where it is.
 */
function LessonRouteScreen(): ReactElement {
  // Widened to `unknown` on the way out of the hook, not held as its own type:
  // that type is the casualty of the cycle described above and is `any`, so a
  // local binding of it is an unchecked value spreading into two query keys.
  const params: unknown = useParams({ from: "/missions/$missionId/lessons/$lessonId" });

  return (
    <LessonScreen
      missionId={pathParam(params, "missionId")}
      lessonId={pathParam(params, "lessonId")}
    />
  );
}

function LibraryRouteScreen(): ReactElement {
  return (
    <LibraryScreen
      missionId={pathParam(useParams({ from: "/missions/$missionId/library" }), "missionId")}
    />
  );
}

export const lessonRoute = screen("/missions/$missionId/lessons/$lessonId", LessonRouteScreen);
export const libraryRoute = screen("/missions/$missionId/library", LibraryRouteScreen);
export const insightsRoute = screen("/insights", InsightsScreen);
export const settingsRoute = screen("/settings", SettingsScreen);

const routeTree = rootRoute.addChildren([
  todayRoute,
  missionsRoute,
  curriculumRoute,
  lessonRoute,
  libraryRoute,
  insightsRoute,
  settingsRoute,
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    // The shell renders the chrome and decides what goes inside it, so a route that does not exist
    // should land on Today rather than on a blank column. A typo in a bookmark is not an error page.
    defaultNotFoundComponent: TodayScreen,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

/**
 * The nav, in one place, so the bar and the command palette cannot drift.
 *
 * They already had: the `Screen` union was written in `App.tsx` and again in `CommandActions`'s prop
 * type, and the list of screens a third time in its `going` array — so widening the union added a
 * screen to the bar and silently omitted it from ⌘K.
 */
export const NAV_ROUTES = [
  { path: "/", labelKey: "nav.today" },
  { path: "/missions", labelKey: "nav.missions" },
  { path: "/insights", labelKey: "nav.insights" },
  // Settings is in the nav rather than tucked behind an icon: it is where the timezone lives.
  // §14.1 also puts "What's new" here.
  { path: "/settings", labelKey: "nav.settings" },
] as const;

export type NavPath = (typeof NAV_ROUTES)[number]["path"];
