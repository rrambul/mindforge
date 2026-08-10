import { beforeEach, describe, expect, it } from "vitest";
import { ProfileNotFound } from "../domain/errors.js";
import type { Profile, SettingsPatch } from "../domain/profile.js";
import type { ProfileRepository } from "../domain/profile.repository.js";
import { MarkChangelogSeen, ReadProfile, UpdateSettings } from "./account.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const MISSING = "99999999-9999-4999-8999-999999999999";

const ALICES_PROFILE: Profile = {
  userId: ALICE,
  locale: "en",
  contentLanguage: "en",
  timezone: "UTC",
  weekStartsOn: 1,
  theme: "light",
  changelogSeenVersion: null,
};

/**
 * Records the patch it was handed, because the thing worth asserting about a settings write is
 * which columns it named — not only what the row ended up looking like.
 */
class InMemoryProfiles implements ProfileRepository {
  private readonly byUser = new Map<string, Profile>();
  readonly patches: SettingsPatch[] = [];

  constructor(...profiles: readonly Profile[]) {
    for (const profile of profiles) this.byUser.set(profile.userId, profile);
  }

  find(userId: string): Promise<Profile | null> {
    return Promise.resolve(this.byUser.get(userId) ?? null);
  }

  updateSettings(userId: string, patch: SettingsPatch): Promise<Profile | null> {
    this.patches.push(patch);
    const current = this.byUser.get(userId);
    if (!current) return Promise.resolve(null);

    const updated: Profile = { ...current, ...patch };
    this.byUser.set(userId, updated);
    return Promise.resolve(updated);
  }

  markChangelogSeen(userId: string, version: string): Promise<Profile | null> {
    const current = this.byUser.get(userId);
    if (!current) return Promise.resolve(null);

    const updated: Profile = { ...current, changelogSeenVersion: version };
    this.byUser.set(userId, updated);
    return Promise.resolve(updated);
  }
}

describe("ReadProfile", () => {
  it("returns the stored settings", async () => {
    const profiles = new InMemoryProfiles(ALICES_PROFILE);

    await expect(new ReadProfile(profiles).execute(ALICE)).resolves.toEqual(ALICES_PROFILE);
  });

  it("reports a profile that is no longer there", async () => {
    // Nearly unreachable — the guard read this row a moment ago — but the alternative is asserting
    // non-null on a value the database owns, and an account deleted mid-request would be a 500.
    const profiles = new InMemoryProfiles();

    await expect(new ReadProfile(profiles).execute(MISSING)).rejects.toBeInstanceOf(
      ProfileNotFound,
    );
  });
});

describe("UpdateSettings", () => {
  let profiles: InMemoryProfiles;

  beforeEach(() => {
    profiles = new InMemoryProfiles(ALICES_PROFILE);
  });

  it("writes the settings M2 cannot run without", async () => {
    const updated = await new UpdateSettings(profiles).execute(ALICE, {
      timezone: "America/Sao_Paulo",
      weekStartsOn: 0,
    });

    expect(updated.timezone).toBe("America/Sao_Paulo");
    expect(updated.weekStartsOn).toBe(0);
  });

  it("names only the columns the body carried", async () => {
    // The whole point of PATCH here: a settings form that posted the object it rendered would
    // revert whatever a second tab changed in the meantime.
    await new UpdateSettings(profiles).execute(ALICE, { theme: "dark" });

    expect(Object.keys(profiles.patches[0] ?? {})).toEqual(["theme"]);
  });

  it("leaves the week start alone when the locale changes", async () => {
    // FR-L5: week start is seeded from locale at signup and owned by the user afterwards. Deriving
    // it here would silently re-bucket every week the user has already planned.
    const updated = await new UpdateSettings(profiles).execute(ALICE, { locale: "pt-BR" });

    expect(updated.locale).toBe("pt-BR");
    expect(updated.weekStartsOn).toBe(1);
  });

  it("keeps the content language separate from the interface language", async () => {
    // FR-L3: a pt-BR interface with English lessons is a legitimate and likely combination, so
    // neither setting may move the other.
    const settings = new UpdateSettings(profiles);

    expect((await settings.execute(ALICE, { locale: "pt-BR" })).contentLanguage).toBe("en");
    expect((await settings.execute(ALICE, { contentLanguage: "pt-BR" })).locale).toBe("pt-BR");
  });

  it("reports a profile that is no longer there", async () => {
    await expect(
      new UpdateSettings(profiles).execute(MISSING, { theme: "dark" }),
    ).rejects.toBeInstanceOf(ProfileNotFound);
  });
});

describe("MarkChangelogSeen", () => {
  it("records the version without touching a single setting", async () => {
    // §14.1 — the reason this is not a field on the settings patch.
    const profiles = new InMemoryProfiles({ ...ALICES_PROFILE, theme: "dark" });

    const updated = await new MarkChangelogSeen(profiles).execute(ALICE, { version: "0.4.1" });

    expect(updated.changelogSeenVersion).toBe("0.4.1");
    expect(updated.theme).toBe("dark");
  });

  it("reports a profile that is no longer there", async () => {
    await expect(
      new MarkChangelogSeen(new InMemoryProfiles()).execute(MISSING, { version: "1.0.0" }),
    ).rejects.toBeInstanceOf(ProfileNotFound);
  });
});
