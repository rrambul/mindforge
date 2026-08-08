import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";
import type { ReactElement } from "react";
import { NotesRoute } from "../features/notes/routes/NotesRoute.js";
import { GoalsScreen } from "./GoalsScreen.js";
import { MissionsScreen } from "./MissionsScreen.js";
import { ResourcesScreen } from "./ResourcesScreen.js";
import { Shell } from "./Shell.js";
import { SkillsScreen } from "./SkillsScreen.js";
import { TodayScreen } from "./TodayScreen.js";

/**
 * The route tree, which App.tsx and AppShell.tsx have each been deferring since M1.
 *
 * Both said the same thing in a comment: the tree earns its place at "the next screen that needs to
 * be linked *to*", and it should be designed against real routes rather than retrofitted around
 * guessed ones. M2 brings three at once — a specific week, that week's review, and Settings — and
 * every one of them is a thing you want to bookmark, send to yourself, or reach with Back.
 *
 * **Signed out is not a route.** `/` renders the sign-in form when there is no session, rather than
 * redirecting to `/sign-in`. Two reasons: the session is read asynchronously from storage, so a
 * redirect on "not yet known" flashes the form on every reload — the bug `apps/web/e2e/README.md`
 * already records as untested — and a redirect loses the URL you were trying to reach. Rendering in
 * place keeps the address bar pointing where you asked to go, so signing in lands you there.
 *
 * **Code-based, not file-based.** File-based routing needs a bundler plugin and a generated tree
 * checked into the repo; this is nine routes in one readable file, and a generated artifact is a
 * thing to keep in sync for no gain at this size.
 */

/** What every route can reach without prop-drilling through the shell. */
export interface RouterContext {
  readonly signedIn: boolean;
  /** IANA, from the profile. Every "week" a route resolves derives from it (§5.2). */
  readonly timezone: string;
  /** 0 = Sunday. Owned by the user, never re-derived from locale at render (FR-L5). */
  readonly weekStartsOn: 0 | 1;
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  // The shell renders the bar and an `Outlet`, so it is the root's component rather than something
  // wrapped around `RouterProvider` — the outlet has to be *inside* the chrome.
  component: Shell,
});

/**
 * One `createRoute` per screen, gathered below.
 *
 * Written out rather than generated from a table so that a route with a param — `/weeks/$weekStart`
 * — reads the same as one without, and so `router.d.ts`-style inference keeps working on the paths.
 */
function screen(path: string, component: () => ReactElement): AnyRoute {
  return createRoute({ getParentRoute: () => rootRoute, path, component });
}

export const todayRoute = screen("/", TodayScreen);
export const missionsRoute = screen("/missions", MissionsScreen);
export const goalsRoute = screen("/goals", GoalsScreen);
export const skillsRoute = screen("/skills", SkillsScreen);
export const notesRoute = screen("/notes", NotesRoute);
/**
 * `/library`, not `/resources`. The nav has always called this screen Library, and a URL that
 * disagrees with the label above it is a small lie you have to remember.
 */
export const libraryRoute = screen("/library", ResourcesScreen);

const routeTree = rootRoute.addChildren([
  todayRoute,
  missionsRoute,
  goalsRoute,
  skillsRoute,
  notesRoute,
  libraryRoute,
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
  { path: "/goals", labelKey: "nav.goals" },
  { path: "/skills", labelKey: "nav.skills" },
  { path: "/notes", labelKey: "nav.notes" },
  { path: "/library", labelKey: "nav.resources" },
] as const;

export type NavPath = (typeof NAV_ROUTES)[number]["path"];
