import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMe } from "../features/auth/api/use-me.js";
import { useSupabaseSession } from "../features/auth/api/use-supabase-session.js";
import { SignInForm } from "../features/auth/ui/SignInForm.js";
import { MissionsRoute } from "../features/missions/routes/MissionsRoute.js";
import { supabase } from "../shared/api/supabase.js";
import { guessLocaleFromBrowser } from "../shared/lib/i18n.js";
import { OfflineQueueProvider, useOfflineQueue } from "../shared/lib/queue-context.js";
import { useTheme } from "../shared/lib/theme.js";
import { Button } from "../shared/ui/Button.js";
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

type Screen = "today" | "missions";

function Shell({ signedIn, sessionKnown }: ShellProps) {
  const { t } = useTranslation("common");
  const { t: auth } = useTranslation("auth");
  const { theme, toggle } = useTheme();
  // Two screens, so two buttons — still not a router. When Today grows a "next" block that
  // deep-links into a mission, and mission detail exists to link to, that is the moment the
  // route tree earns its place and can be designed against real routes.
  const [screen, setScreen] = useState<Screen>("today");

  return (
    <div className="mf-shell">
      <header className="mf-topbar">
        <div className="mf-row">
          <span className="mf-brand">{t("appName")}</span>
          {signedIn ? (
            <nav className="mf-nav" aria-label={t("appName")}>
              {(["today", "missions"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="mf-nav__item"
                  aria-current={screen === item ? "page" : undefined}
                  onClick={() => setScreen(item)}
                >
                  {t(`nav.${item}`)}
                </button>
              ))}
            </nav>
          ) : null}
        </div>
        <div className="mf-row">
          <Button variant="quiet" onClick={toggle} aria-label={t("theme.toggle")}>
            {t(theme === "dark" ? "theme.light" : "theme.dark")}
          </Button>
          {signedIn ? <PendingCaptures /> : null}
          {signedIn ? (
            <Button variant="quiet" onClick={() => void supabase.auth.signOut()}>
              {auth("signOut")}
            </Button>
          ) : null}
        </div>
      </header>

      <main className="mf-main">
        {/* Undetermined is not signed out: rendering the sign-in form while the stored
            session is still being read would flash it on every reload. */}
        {!sessionKnown ? (
          <p className="mf-muted">{t("state.loading")}</p>
        ) : signedIn ? (
          screen === "today" ? (
            <TodayScreen />
          ) : (
            <MissionsRoute />
          )
        ) : (
          <SignInForm />
        )}
      </main>
    </div>
  );
}

/**
 * Says how many captures are waiting to reach the server.
 *
 * Present because the alternative is dishonest: the capture paths are optimistic, so a tap looks
 * identical whether it saved or is sitting in IndexedDB. Silence would mean the app told you
 * everything was fine while holding data it had not sent — and this product's one job is telling
 * you the truth about your own data.
 *
 * Absent when the queue is empty. A permanent "0 pending" is noise.
 */
function PendingCaptures() {
  const { t } = useTranslation("common");
  const offline = useOfflineQueue();

  if (!offline || offline.pending === 0) return null;

  return (
    <span className="mf-chip" role="status">
      {t("offline.pending", { count: offline.pending })}
    </span>
  );
}
