import { defaultNotificationPrefs, type NotificationPref } from "@mindforge/core";
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../shared/time/clock.js";
import {
  DuplicateNotificationKind,
  NotificationNotFound,
  ProfileNotFound,
} from "../domain/errors.js";
import type { StoredNotificationPref } from "../domain/notification-prefs.js";
import { Notification } from "../domain/notification.js";
import type { NotificationRepository } from "../domain/notification.repository.js";
import type { Profile, SettingsPatch } from "../domain/profile.js";
import type { ProfileRepository } from "../domain/profile.repository.js";
import {
  DismissNotification,
  ListNotifications,
  MarkChangelogSeen,
  ReadNotificationPrefs,
  ReadProfile,
  SaveNotificationPrefs,
  UpdateSettings,
} from "./account.use-cases.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const MISSING = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-08-05T09:00:00Z");
const LATER = new Date("2026-08-05T18:30:00Z");

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

class InMemoryNotifications implements NotificationRepository {
  private readonly notifications = new Map<string, Map<string, Notification>>();
  private readonly prefRows = new Map<string, StoredNotificationPref[]>();

  private own(userId: string): Map<string, Notification> {
    const existing = this.notifications.get(userId);
    if (existing) return existing;
    const created = new Map<string, Notification>();
    this.notifications.set(userId, created);
    return created;
  }

  add(userId: string, notification: Notification): Notification {
    this.own(userId).set(notification.id, notification);
    return notification;
  }

  /** Writes a row straight in, the way an older version of the app would have left it. */
  seedRow(userId: string, row: StoredNotificationPref): void {
    this.prefRows.set(userId, [...(this.prefRows.get(userId) ?? []), row]);
  }

  listUndismissed(userId: string): Promise<Notification[]> {
    const undismissed = [...this.own(userId).values()].filter((n) => n.dismissedAt === null);
    return Promise.resolve(
      undismissed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  findById(userId: string, id: string): Promise<Notification | null> {
    return Promise.resolve(this.own(userId).get(id) ?? null);
  }

  save(userId: string, notification: Notification): Promise<void> {
    this.own(userId).set(notification.id, notification);
    return Promise.resolve();
  }

  prefs(userId: string): Promise<readonly StoredNotificationPref[]> {
    return Promise.resolve(this.prefRows.get(userId) ?? []);
  }

  savePrefs(userId: string, prefs: readonly NotificationPref[]): Promise<void> {
    const rows = [...(this.prefRows.get(userId) ?? [])];
    for (const pref of prefs) {
      const row = { kind: pref.kind, enabled: pref.enabled, config: pref.config };
      const index = rows.findIndex((existing) => existing.kind === pref.kind);
      if (index === -1) rows.push(row);
      else rows[index] = row;
    }
    this.prefRows.set(userId, rows);
    return Promise.resolve();
  }
}

function aNotification(id: string, createdAt: Date): Notification {
  return Notification.fromSnapshot({
    id,
    userId: ALICE,
    kind: "stall",
    payload: { missionTopic: "Rust ownership" },
    subjectType: "mission",
    subjectId: "33333333-3333-4333-8333-333333333333",
    createdAt,
    dismissedAt: null,
  });
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

describe("ReadNotificationPrefs", () => {
  let notifications: InMemoryNotifications;

  beforeEach(() => {
    notifications = new InMemoryNotifications();
  });

  it("gives a profile with no rows every kind at its defaults", async () => {
    // Not an empty list, and nothing seeded: "quiet by default" is about delivery, not an off
    // switch (FR-N4), and a seeded row would freeze today's defaults into the account forever.
    await expect(new ReadNotificationPrefs(notifications).execute(ALICE)).resolves.toEqual(
      defaultNotificationPrefs(),
    );
  });

  it("lets a stored row override its own kind only", async () => {
    notifications.seedRow(ALICE, { kind: "stall", enabled: false, config: { afterDays: 30 } });

    const prefs = await new ReadNotificationPrefs(notifications).execute(ALICE);

    expect(prefs).toContainEqual({ kind: "stall", enabled: false, config: { afterDays: 30 } });
    expect(prefs.find((pref) => pref.kind === "weekly_review")?.enabled).toBe(true);
  });

  it("keeps the switch when a row was written by an older version", async () => {
    // Validated on the way out, not only on the way in: this row never passed through the request
    // schema, and reaching the SPA malformed is exactly what the second parse prevents.
    notifications.seedRow(ALICE, { kind: "stall", enabled: false, config: { staleAfter: 30 } });

    const prefs = await new ReadNotificationPrefs(notifications).execute(ALICE);

    expect(prefs).toContainEqual({ kind: "stall", enabled: false, config: { afterDays: 12 } });
  });

  it("ignores a row for a kind this build has never heard of", async () => {
    notifications.seedRow(ALICE, { kind: "birthday", enabled: true, config: {} });

    await expect(new ReadNotificationPrefs(notifications).execute(ALICE)).resolves.toEqual(
      defaultNotificationPrefs(),
    );
  });

  it("never reads another user's rows", async () => {
    notifications.seedRow(BOB, { kind: "stall", enabled: false, config: {} });

    await expect(new ReadNotificationPrefs(notifications).execute(ALICE)).resolves.toEqual(
      defaultNotificationPrefs(),
    );
  });
});

describe("SaveNotificationPrefs", () => {
  let notifications: InMemoryNotifications;

  beforeEach(() => {
    notifications = new InMemoryNotifications();
  });

  it("stores what it was given and answers with the effective set", async () => {
    const prefs = await new SaveNotificationPrefs(notifications).execute(ALICE, {
      prefs: [{ kind: "stall", enabled: false, config: { afterDays: 21 } }],
    });

    // The kind that was not named comes back at its default, so the response answers the question
    // the next GET would rather than echoing the request.
    expect(prefs).toEqual([
      { kind: "weekly_review", enabled: true, config: { weekday: 0, hour: 18 } },
      { kind: "stall", enabled: false, config: { afterDays: 21 } },
    ]);
  });

  it("leaves a kind it did not name where it was", async () => {
    const save = new SaveNotificationPrefs(notifications);
    await save.execute(ALICE, {
      prefs: [{ kind: "weekly_review", enabled: false, config: { weekday: 2, hour: 7 } }],
    });

    const after = await save.execute(ALICE, {
      prefs: [{ kind: "stall", enabled: true, config: { afterDays: 12 } }],
    });

    expect(after).toContainEqual({
      kind: "weekly_review",
      enabled: false,
      config: { weekday: 2, hour: 7 },
    });
  });

  it("refuses the same kind twice rather than picking one", async () => {
    // The schema cannot catch this: `kind` discriminates a union, so two `stall` entries are a
    // well-formed array. Two entries disagree about the setting, and reporting success for one of
    // them is how a settings screen lies.
    await expect(
      new SaveNotificationPrefs(notifications).execute(ALICE, {
        prefs: [
          { kind: "stall", enabled: false, config: { afterDays: 12 } },
          { kind: "stall", enabled: true, config: { afterDays: 30 } },
        ],
      }),
    ).rejects.toBeInstanceOf(DuplicateNotificationKind);

    // And nothing was written, so the rejection is not half-applied.
    await expect(new ReadNotificationPrefs(notifications).execute(ALICE)).resolves.toEqual(
      defaultNotificationPrefs(),
    );
  });
});

describe("ListNotifications", () => {
  it("returns the undismissed ones, newest first", async () => {
    const notifications = new InMemoryNotifications();
    const older = notifications.add(ALICE, aNotification("a", new Date("2026-08-01T09:00:00Z")));
    const newer = notifications.add(ALICE, aNotification("b", new Date("2026-08-04T09:00:00Z")));

    await expect(new ListNotifications(notifications).execute(ALICE)).resolves.toEqual([
      newer,
      older,
    ]);
  });

  it("drops one that has been dismissed", async () => {
    // FR-N5: no archive of things you failed to act on.
    const notifications = new InMemoryNotifications();
    const dismissed = aNotification("a", NOW);
    dismissed.dismiss(NOW);
    notifications.add(ALICE, dismissed);

    await expect(new ListNotifications(notifications).execute(ALICE)).resolves.toEqual([]);
  });
});

describe("DismissNotification", () => {
  let notifications: InMemoryNotifications;
  let clock: FixedClock;

  beforeEach(() => {
    notifications = new InMemoryNotifications();
    clock = new FixedClock(NOW);
    notifications.add(ALICE, aNotification("a", new Date("2026-08-01T09:00:00Z")));
  });

  it("stamps the moment of the tap", async () => {
    const dismissed = await new DismissNotification(notifications, clock).execute(ALICE, "a");

    expect(dismissed.dismissedAt).toEqual(NOW);
    await expect(new ListNotifications(notifications).execute(ALICE)).resolves.toEqual([]);
  });

  it("keeps the first timestamp when the tap is replayed", async () => {
    const dismiss = new DismissNotification(notifications, clock);
    await dismiss.execute(ALICE, "a");
    clock.set(LATER);

    const again = await dismiss.execute(ALICE, "a");

    expect(again.dismissedAt).toEqual(NOW);
  });

  it("reports one that does not exist", async () => {
    await expect(
      new DismissNotification(notifications, clock).execute(ALICE, MISSING),
    ).rejects.toBeInstanceOf(NotificationNotFound);
  });

  it("cannot dismiss another user's notification", async () => {
    await expect(
      new DismissNotification(notifications, clock).execute(BOB, "a"),
    ).rejects.toBeInstanceOf(NotificationNotFound);
  });
});
