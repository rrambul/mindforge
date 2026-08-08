import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSupabaseSession } from "../features/auth/api/use-supabase-session.js";
import { SignInForm } from "../features/auth/ui/SignInForm.js";
import { supabase } from "../shared/api/supabase.js";
import { useActions } from "../shared/lib/action-registry.js";
import { useOfflineQueue } from "../shared/lib/queue-context.js";
import { useTheme } from "../shared/lib/theme.js";
import { Button, Row, StatusChip, Text } from "../shared/ui/index.js";
import { AppShell, Brand, Nav, type NavItem } from "./AppShell.js";
import { CommandActions } from "./CommandActions.js";
import { Logo } from "./Logo.js";
import { NAV_ROUTES } from "./router.js";

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
  const { theme, toggle } = useTheme();
  const { session } = useSupabaseSession();
  const signedIn = session != null;
  const sessionKnown = session !== undefined;

  // One list, read from the route table. It used to be written three times — here, in
  // `CommandActions`'s prop type, and again in its `going` array — so adding a screen put it in the
  // bar and silently left it out of the command palette.
  const items: NavItem[] = NAV_ROUTES.map((route) => ({
    to: route.path,
    label: t(route.labelKey),
  }));

  return (
    <CommandActions>
      <AppShell
        bar={
          <>
            <Row>
              <Brand>
                <Logo />
                {t("appName")}
              </Brand>
              {signedIn ? <Nav label={t("appName")} items={items} /> : null}
            </Row>
            <Row>
              {/* A visible trigger as well as the keystroke. Cmd-K is the fast path for someone who
                  knows it exists, and on a phone there is no keyboard at all — 5.1 asks for a single
                  persistent button opening the same actions. */}
              {signedIn ? <OpenCommands /> : null}
              <Button variant="quiet" onClick={toggle} aria-label={t("theme.toggle")}>
                {t(theme === "dark" ? "theme.light" : "theme.dark")}
              </Button>
              {signedIn ? <PendingCaptures /> : null}
              {signedIn ? (
                <Button variant="quiet" onClick={() => void supabase.auth.signOut()}>
                  {auth("signOut")}
                </Button>
              ) : null}
            </Row>
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
 * is a keystroke nobody uses, and this is the app's primary desktop surface (§5.1).
 */
function OpenCommands() {
  const { t } = useTranslation("command");
  const registry = useActions();

  if (!registry) return null;

  return (
    <Button variant="quiet" onClick={registry.open}>
      {`${t("open")} ${t("openHint")}`}
    </Button>
  );
}

function PendingCaptures() {
  const { t } = useTranslation("common");
  const offline = useOfflineQueue();

  if (!offline || offline.pending === 0) return null;

  return <StatusChip live>{t("offline.pending", { count: offline.pending })}</StatusChip>;
}
