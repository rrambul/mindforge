import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { useSupabaseSession } from "../features/auth/api/use-supabase-session.js";
import { SignInForm } from "../features/auth/ui/SignInForm.js";
import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { NotesRoute } from "../features/notes/routes/NotesRoute.js";
import { ResourcesRoute } from "../features/resources/routes/ResourcesRoute.js";
import { supabase } from "../shared/api/supabase.js";
import { guessLocaleFromBrowser } from "../shared/lib/i18n.js";
import { OfflineQueueProvider, useOfflineQueue } from "../shared/lib/queue-context.js";
import { useTheme } from "../shared/lib/theme.js";
import { Button, Row, StatusChip, Text } from "../shared/ui/index.js";
import { AppShell, Brand, Nav, type NavItem } from "./AppShell.js";
import { createQueryClient, I18nProvider } from "./providers.js";
import { TodayScreen } from "./TodayScreen.js";

/**
 * The shell.
 *
 * There is deliberately no router yet. TanStack Router is a dependency and the route
 * tree lands with the second screen — right now there are two states, signed out and
 * missions, and a route tree over that would be ceremony describing nothing. Adding it
 * once Today, mission detail, and the review queue exist means designing it against
 * real routes rather than guessed ones.
 */
export function App(): React.JSX.Element {
  // Created once. A new QueryClient per render would discard every cached response,
  // and a locale change would silently become a full refetch of the app.
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Inside Query because the queue sends through the http client; outside the screens
          because every capture path enqueues into the same one. */}
      <OfflineQueueProvider>
        <LocalisedApp />
      </OfflineQueueProvider>
    </QueryClientProvider>
  );
}

/**
 * Resolves the interface language before rendering anything that has words in it.
 *
 * The browser's guess covers the sign-in screen, where there is no profile to read yet.
 * Once there is a session the profile wins, because that is the locale the API
 * translates its error `detail` strings from — a client that kept guessing would show a
 * Portuguese interface with English errors, or the reverse.
 */
function LocalisedApp() {
  const browserLocale = useMemo(() => guessLocaleFromBrowser(), []);
  const { session } = useSupabaseSession();
  const signedIn = session != null;
  const me = useMe(signedIn);

  return (
    <I18nProvider locale={me.data?.locale ?? browserLocale}>
      <Shell signedIn={signedIn} sessionKnown={session !== undefined} />
    </I18nProvider>
  );
}

interface ShellProps {
  readonly signedIn: boolean;
  readonly sessionKnown: boolean;
}

type Screen = "today" | "missions" | "notes" | "resources";

/**
 * A lookup rather than a chain of ternaries, which stopped being readable at the third screen.
 *
 * Components rather than elements, so a screen is only constructed when it is the current one —
 * `{today: <TodayScreen />, ...}` would build all four on every render.
 */
const SCREENS: Readonly<Record<Screen, () => ReactElement>> = {
  today: TodayScreen,
  missions: MissionsRoute,
  notes: NotesRoute,
  resources: ResourcesRoute,
};

function Shell({ signedIn, sessionKnown }: ShellProps) {
  const { t } = useTranslation("common");
  const { t: auth } = useTranslation("auth");
  const { theme, toggle } = useTheme();
  // Four screens and still not a router — but this is the last one that can be justified. There is no
  // URL for a resource, so the library cannot be linked to, bookmarked, or shared, and a browser Back
  // does not go back. The next screen that needs to be linked *to* is where the route tree earns its
  // place, and it should be designed against real routes rather than retrofitted around these.
  const [screen, setScreen] = useState<Screen>("today");

  const items: NavItem<Screen>[] = [
    { id: "today", label: t("nav.today") },
    { id: "missions", label: t("nav.missions") },
    { id: "notes", label: t("nav.notes") },
    { id: "resources", label: t("nav.resources") },
  ];

  return (
    <AppShell
      bar={
        <>
          <Row>
            <Brand>{t("appName")}</Brand>
            {signedIn ? (
              <Nav label={t("appName")} items={items} current={screen} onSelect={setScreen} />
            ) : null}
          </Row>
          <Row>
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
        (() => {
          const Screen = SCREENS[screen];
          return <Screen />;
        })()
      ) : (
        <SignInForm />
      )}
    </AppShell>
  );
}

function PendingCaptures() {
  const { t } = useTranslation("common");
  const offline = useOfflineQueue();

  if (!offline || offline.pending === 0) return null;

  return <StatusChip live>{t("offline.pending", { count: offline.pending })}</StatusChip>;
}
