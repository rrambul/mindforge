import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "../../../test/msw.js";
import { renderWithProviders } from "../../../test/render.js";
import type { Release } from "../api/use-changelog.js";
import type { Profile } from "../api/use-profile.js";
import { SettingsRoute } from "./SettingsRoute.js";

vi.mock("../../../shared/api/supabase.js", () => ({
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
  // Up to date by default, so the "seen" POST is not fired by tests that are about something else.
  changelogSeenVersion: "0.1.0",
};

const RELEASES = [
  {
    version: "0.1.0",
    date: "2026-08-07",
    body: "### The weekly rhythm (M2)\n\n- **Settings.** Timezone, interface language, and theme.\n  Before this the timezone could not be changed.\n",
  },
];

function settingsServer(profile: Profile = STORED, releases: Release[] = RELEASES) {
  // Call signatures given explicitly: a bare `vi.fn()` infers a constructor-or-function union that
  // is not callable, so recording the body would not type-check.
  const sent = {
    profile: vi.fn<(patch: Partial<Profile>) => void>(),
    seen: vi.fn<(body: unknown) => void>(),
  };
  let current = profile;

  server.use(
    http.get(`${API}/me`, () => HttpResponse.json(current)),
    http.patch(`${API}/me`, async ({ request }) => {
      const patch = (await request.json()) as Partial<Profile>;
      sent.profile(patch);
      current = { ...current, ...patch };
      return HttpResponse.json(current);
    }),
    http.post(`${API}/me/changelog-seen`, async ({ request }) => {
      sent.seen(await request.json());
      return HttpResponse.json(current);
    }),
    // Same origin as the SPA, not the API — it is a build artifact, not an endpoint.
    http.get("*/changelog.json", () => HttpResponse.json(releases)),
  );

  return sent;
}

/** Two cards carry a Save button, so every assertion about one has to say which. */
const calendarCard = () => screen.findByRole("region", { name: "Language and calendar" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("the three axes (§5.2)", () => {
  it("offers interface language and lesson language as separate settings", async () => {
    // Collapsing them is the mistake §5.2 names: a pt-BR interface with English lessons is the
    // combination this product was built for.
    settingsServer();
    renderWithProviders(<SettingsRoute />);

    expect(await screen.findByLabelText("Interface language")).toBeVisible();
    expect(screen.getByLabelText("Lesson language")).toBeVisible();
    expect(screen.getByLabelText("Timezone")).toBeVisible();
  });

  it("saves nothing until something is different", async () => {
    settingsServer();
    renderWithProviders(<SettingsRoute />);

    expect(within(await calendarCard()).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("sends only the field that moved", async () => {
    // Absent means unchanged. Posting the whole object would revert what a second tab changed.
    const sent = settingsServer();
    renderWithProviders(<SettingsRoute />);

    const card = await calendarCard();
    await userEvent.selectOptions(within(card).getByLabelText("Lesson language"), "pt-BR");
    await userEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent.profile).toHaveBeenCalledWith({ contentLanguage: "pt-BR" }));
  });
});

describe("the timezone picker (FR-L5)", () => {
  it("accepts a zone Intl knows and says what time it is there", async () => {
    const sent = settingsServer();
    renderWithProviders(<SettingsRoute />);

    const card = await calendarCard();
    const box = within(card).getByLabelText("Timezone");
    await userEvent.clear(box);
    await userEvent.type(box, "America/Sao_Paulo");

    // The string is not the thing being chosen; the local time is, and it is how you notice you
    // picked the wrong one.
    expect(await screen.findByText(/It is .* there right now/)).toBeVisible();

    await userEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(sent.profile).toHaveBeenCalledWith({ timezone: "America/Sao_Paulo" }),
    );
  });

  it("refuses one Intl does not know rather than letting the server say no", async () => {
    settingsServer();
    renderWithProviders(<SettingsRoute />);

    const card = await calendarCard();
    const box = within(card).getByLabelText("Timezone");
    await userEvent.clear(box);
    await userEvent.type(box, "Mars/Olympus");

    expect(await screen.findByRole("alert")).toHaveTextContent(/Not a timezone/);
    expect(within(card).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("offers the list from Intl rather than from a hardcoded file", async () => {
    settingsServer();
    const { container } = renderWithProviders(<SettingsRoute />);

    await screen.findByLabelText("Timezone");
    const options = container.querySelectorAll("datalist option");
    // ~418 zones. A list in the repo would be wrong within a year.
    expect(options.length).toBeGreaterThan(100);
  });

  it("warns that a calendar change re-buckets what is already on screen", async () => {
    settingsServer();
    renderWithProviders(<SettingsRoute />);

    await userEvent.selectOptions(await screen.findByLabelText("Week starts on"), "0");
    expect(screen.getByText(/moves every day and week already on screen/)).toBeVisible();
  });
});

describe("the theme", () => {
  it("applies on the pick and writes it to the account", async () => {
    // The bar's toggle and this select are the same mechanism; a Save button between the pick and
    // the effect would make them behave differently.
    const sent = settingsServer();
    renderWithProviders(<SettingsRoute />);

    await userEvent.selectOptions(await screen.findByLabelText("Theme"), "dark");

    expect(document.documentElement.dataset["theme"]).toBe("dark");
    await waitFor(() => expect(sent.profile).toHaveBeenCalledWith({ theme: "dark" }));
  });

  it("lets the stored profile win over the device's copy", async () => {
    // localStorage is a cache for the first paint; the account is the setting. Otherwise signing in
    // on a second machine silently rewrites it with that machine's default.
    localStorage.setItem("mindforge.theme", "light");
    settingsServer({ ...STORED, theme: "dark" });
    renderWithProviders(<SettingsRoute />);

    await waitFor(() => expect(document.documentElement.dataset["theme"]).toBe("dark"));
    expect(localStorage.getItem("mindforge.theme")).toBe("dark");
  });
});

describe("what's new (§14.1)", () => {
  it("renders the entry as prose rather than as raw Markdown", async () => {
    settingsServer();
    renderWithProviders(<SettingsRoute />);

    const release = await screen.findByRole("article", { name: "0.1.0" });
    expect(within(release).getByText("Settings.")).toBeVisible();
    // The asterisks are markup, not content. Left literal, the file written for a reader stops
    // reading like one.
    expect(within(release).queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("marks the changelog seen because you opened the screen", async () => {
    const sent = settingsServer({ ...STORED, changelogSeenVersion: null });
    renderWithProviders(<SettingsRoute />);

    await screen.findByRole("article", { name: "0.1.0" });
    await waitFor(() => expect(sent.seen).toHaveBeenCalledWith({ version: "0.1.0" }));
  });

  it("does not re-mark what was already seen", async () => {
    const sent = settingsServer();
    renderWithProviders(<SettingsRoute />);

    await screen.findByRole("article", { name: "0.1.0" });
    expect(sent.seen).not.toHaveBeenCalled();
  });

  it("says the notes are missing rather than looking like nothing ever shipped", async () => {
    settingsServer(STORED, []);
    renderWithProviders(<SettingsRoute />);

    expect(await screen.findByText(/Nothing has shipped under a version yet/)).toBeVisible();
  });
});

describe("pt-BR", () => {
  it("renders the screen in Portuguese", async () => {
    settingsServer();
    renderWithProviders(<SettingsRoute />, { locale: "pt-BR" });

    expect(await screen.findByText("Configurações")).toBeVisible();
  });
});
