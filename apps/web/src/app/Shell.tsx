import { Outlet, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSupabaseSession } from "../features/auth/api/use-supabase-session.js";
import { SignInForm } from "../features/auth/ui/SignInForm.js";
import { useThemeSetting } from "../features/settings/api/use-theme-setting.js";
import { ChangelogDot } from "../features/settings/ui/ChangelogDot.js";
import { supabase } from "../shared/api/supabase.js";
import { useActions } from "../shared/lib/action-registry.js";
import { useOfflineQueue } from "../shared/lib/queue-context.js";
import { Button, StatusChip, Text } from "../shared/ui/index.js";
import { AppShell, BarActions, Brand, Nav, type NavItem } from "./AppShell.js";
import { CommandActions } from "./CommandActions.js";
import { Logo } from "./Logo.js";
import { LESSON_PATH, NAV_ROUTES } from "./router.js";

/**
 * The chrome, and the root route's component.
 *
 * It lives in its own file because the router needs it and it needs the router: the root route
 * renders this, and this renders the `Outlet` the rest of the tree goes into. Leaving it in
 * `App.tsx` — which constructs the router — would be an import cycle.
 *
 * It reads the session itself rather than taking props, because a root route component is
 * constructed by the router and has nowhere for props to come from. Both hooks are cheap: the
 * session is a subscription and `useMe` is a query with `staleTime: Infinity`, so this is the same
 * cached answer `App` already has rather than a second request.
 */
export function Shell() {
  const { t } = useTranslation("common");
  const { t: auth } = useTranslation("auth");
  const { session } = useSupabaseSession();
  const signedIn = session != null;
  // `useThemeSetting`, not the localStorage-only `useTheme` this used to call. There are now two
  // controls for one preference — this toggle and a select in Settings — and the old hook wrote only
  // to the device, so the bar's choice was a preview the next profile read silently reverted.
  const { theme, toggle } = useThemeSetting(signedIn);
  const sessionKnown = session !== undefined;

  // One list, read from the route table. It used to be written three times — here, in
  // `CommandActions`'s prop type, and again in its `going` array — so adding a screen put it in the
  // bar and silently left it out of the command palette.
  const items: NavItem[] = NAV_ROUTES.map((route) => ({
    to: route.path,
    label: t(route.labelKey),
  }));

  /**
   * The reader gets a slimmer bar, and no nav row at all.
   *
   * It is the one screen whose content is a document rather than a page of ours: the
   * frame is sized against the viewport, so app chrome above it comes directly out of
   * the lesson. The nav is what makes the bar tall — four items and thirteen-character
   * labels wrap to a second row below 640px, which cost 60px of a 667px phone.
   *
   * Dropping it here rather than shrinking it is safe *because* of two things that
   * already exist: ⌘K reads its list from `NAV_ROUTES`, the same table this bar does,
   * and there is a visible button beside it for the phones with no ⌘ to press (§5.1).
   * The reader also renders its own "back to the curriculum" link, so the way out is
   * one tap without the bar. Nothing here is the only route to anywhere.
   *
   * The hook is called unconditionally and narrowed after: one behind `signedIn &&`
   * is a hook that does not run for a signed-out render, which is the one rule React
   * has about them.
   */
  const matchRoute = useMatchRoute();
  const reading = signedIn && matchRoute({ to: LESSON_PATH }) !== false;

  return (
    <CommandActions>
      <AppShell
        compact={reading}
        bar={
          <>
            <Brand mark={<Logo />}>{t("appName")}</Brand>
            {signedIn && !reading ? <Nav label={t("appName")} items={items} /> : null}
            <BarActions>
              {/* A visible trigger as well as the keystroke. Cmd-K is the fast path for someone who
                  knows it exists, and on a phone there is no keyboard at all — 5.1 asks for a single
                  persistent button opening the same actions. */}
              {signedIn ? <OpenCommands /> : null}
              <Button variant="bar" onClick={toggle} aria-label={t("theme.toggle")}>
                {t(theme === "dark" ? "theme.light" : "theme.dark")}
              </Button>
              {signedIn ? <ChangelogDot /> : null}
              {signedIn ? <PendingCaptures /> : null}
              {signedIn ? (
                <Button variant="bar" onClick={() => void supabase.auth.signOut()}>
                  {auth("signOut")}
                </Button>
              ) : null}
            </BarActions>
          </>
        }
      >
        {/* Undetermined is not signed out: rendering the sign-in form while the stored session is
            still being read would flash it on every reload. */}
        {!sessionKnown ? (
          <Text tone="muted">{t("state.loading")}</Text>
        ) : signedIn ? (
          <Outlet />
        ) : (
          <SignInForm />
        )}
      </AppShell>
    </CommandActions>
  );
}

/**
 * Opens the command surface.
 *
 * Shows the shortcut beside the label rather than only in a tooltip: a keystroke nobody is told about
 * is a keystroke nobody uses, and this is the app's primary desktop surface (§5.1). The keycap is
 * `aria-hidden` and hidden below 640px — a phone has no ⌘ to press — while `aria-keyshortcuts`
 * carries the same fact to a screen reader at every width.
 */
function OpenCommands() {
  const { t } = useTranslation("command");
  const registry = useActions();

  if (!registry) return null;

  return (
    <Button variant="bar" onClick={registry.open} aria-keyshortcuts="Meta+K">
      {t("open")}
      <kbd className="mf-topbar__hint" aria-hidden="true">
        {t("openHint")}
      </kbd>
    </Button>
  );
}

function PendingCaptures() {
  const { t } = useTranslation("common");
  const offline = useOfflineQueue();

  if (!offline || offline.pending === 0) return null;

  return <StatusChip live>{t("offline.pending", { count: offline.pending })}</StatusChip>;
}
