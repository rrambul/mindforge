import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meKeys, useMe } from "../features/auth/api/use-me.js";
import { profileKeys, type Profile } from "../features/settings/api/use-profile.js";
import { API, server } from "../test/msw.js";
import { renderWithProviders } from "../test/render.js";
import { SettingsScreen } from "./SettingsScreen.js";

vi.mock("../shared/api/supabase.js", () => ({
  currentAccessToken: () => Promise.resolve("test-token"),
  supabase: { auth: {} },
}));

const STORED: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  locale: "en",
  contentLanguage: "en",
  timezone: "UTC",
  weekStartsOn: 1,
  theme: "light",
  // Up to date, so opening the screen does not fire the "seen" POST in tests about something else.
  changelogSeenVersion: "0.1.0",
};

const NUDGE = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "stall",
  payload: { missionTopic: "Rust ownership", days: 14 },
  subjectType: "mission",
  subjectId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-08-07T12:00:00.000Z",
  dismissedAt: null,
};

/** Everything the composed screen reads. MSW errors on an unhandled request, so this is the list. */
function settingsServer(nudges: object[] = [NUDGE]) {
  let current = STORED;

  server.use(
    http.get(`${API}/me`, () => HttpResponse.json(current)),
    http.patch(`${API}/me`, async ({ request }) => {
      const patch = (await request.json()) as Partial<Profile>;
      current = { ...current, ...patch };
      return HttpResponse.json(current);
    }),
    http.get(`${API}/me/notification-prefs`, () =>
      HttpResponse.json({
        prefs: [
          { kind: "weekly_review", enabled: true, config: { weekday: 0, hour: 18 } },
          { kind: "stall", enabled: true, config: { afterDays: 12 } },
        ],
      }),
    ),
    http.get(`${API}/notifications`, () => HttpResponse.json({ notifications: nudges })),
    http.get("*/changelog.json", () =>
      HttpResponse.json([
        { version: "0.1.0", date: "2026-08-07", body: "- **Settings.** Timezone." },
      ]),
    ),
  );
}

/** Stands in for the shell, which reads the profile through the *other* feature's hook. */
function ShellProbe() {
  const me = useMe(true);
  return <p>{`shell locale: ${me.data?.locale ?? "none"}`}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("one profile, two features reading it", () => {
  it("keys the settings read to the same cache entry the shell already holds", () => {
    // The equality is asserted here because this is the only layer allowed to import both (§2.2
    // rule 6). Query keys are structural, so identical arrays are one entry and one in-flight
    // request — and the test below is what that identity is *for*.
    expect(profileKeys.me).toEqual(meKeys.me);
  });

  it("changes the language the shell is reading, without a reload", async () => {
    // The failure this rules out is quiet: a settings screen keyed to its own array would save
    // successfully, show the new value in its own select, and leave the interface in the old
    // language until the tab was reloaded. Both hooks are mounted here, as they are in the app.
    settingsServer();
    renderWithProviders(
      <>
        <ShellProbe />
        <SettingsScreen />
      </>,
    );

    expect(await screen.findByText("shell locale: en")).toBeVisible();

    const card = await screen.findByRole("region", { name: "Language and calendar" });
    await userEvent.selectOptions(within(card).getByLabelText("Interface language"), "pt-BR");
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("shell locale: pt-BR")).toBeVisible();
    });
  });
});

describe("the composition", () => {
  it("shows the nudges you have beside the settings that schedule them", async () => {
    // Why this wrapper exists: the preferences form is `features/settings` and the nudges are
    // `features/notifications`, and neither may import the other. A schedule whose output you
    // cannot see is a setting you cannot judge.
    settingsServer();
    renderWithProviders(<SettingsScreen />);

    const nudges = await screen.findByRole("region", { name: "Nudges" });
    expect(
      await within(nudges).findByText(
        "No focus session on Rust ownership in 14 days. Still active, or park it?",
      ),
    ).toBeVisible();
  });

  it("offers no link, because a mission has no page of its own yet", async () => {
    // `SettingsScreen` passes no `hrefFor`. A link that landed on the missions list would be worse
    // than none — this asserts the absence is the deliberate one, not a forgotten prop.
    settingsServer();
    renderWithProviders(<SettingsScreen />);

    const nudges = await screen.findByRole("region", { name: "Nudges" });
    await within(nudges).findByText(/Rust ownership/);
    expect(within(nudges).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });

  it("says so when there is nothing waiting, rather than showing an empty box", async () => {
    settingsServer([]);
    renderWithProviders(<SettingsScreen />);

    const nudges = await screen.findByRole("region", { name: "Nudges" });
    expect(await within(nudges).findByText("Nothing to tell you.")).toBeVisible();
  });
});
