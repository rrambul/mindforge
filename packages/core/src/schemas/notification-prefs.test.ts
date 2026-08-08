import { describe, expect, it } from "vitest";
import {
  defaultNotificationPrefs,
  mergeNotificationPrefs,
  readStoredPref,
  type NotificationPref,
} from "./notification.js";

describe("readStoredPref", () => {
  it("reads a row this build wrote", () => {
    const pref = readStoredPref({
      kind: "weekly_review",
      enabled: true,
      config: { weekday: 3, hour: 9 },
    });

    expect(pref).toEqual({ kind: "weekly_review", enabled: true, config: { weekday: 3, hour: 9 } });
  });

  it("fills the config defaults in for the empty jsonb the column defaults to", () => {
    const pref = readStoredPref({ kind: "stall", enabled: false, config: {} });

    expect(pref).toEqual({ kind: "stall", enabled: false, config: { afterDays: 12 } });
  });

  it("keeps the switch when the config is one an older version wrote", () => {
    // The failure this exists for: `enabled: false` must survive a config we can no longer parse.
    // FR-N4's argument is that a nagging app gets muted then deleted — silently un-muting someone
    // because a key was renamed is the one outcome worse than losing the config.
    const pref = readStoredPref({
      kind: "stall",
      enabled: false,
      config: { staleAfterDays: 30 },
    });

    expect(pref).toEqual({ kind: "stall", enabled: false, config: { afterDays: 12 } });
  });

  it("rejects a config that belongs to the other kind", () => {
    // Strictness is what stops the jsonb column becoming a junk drawer: a weekly-review config
    // posted against `stall` would otherwise be stripped and stored as the defaults.
    const pref = readStoredPref({ kind: "stall", enabled: true, config: { weekday: 0, hour: 18 } });

    expect(pref).toEqual({ kind: "stall", enabled: true, config: { afterDays: 12 } });
  });

  it("gives up on a kind it has never heard of", () => {
    expect(readStoredPref({ kind: "birthday", enabled: true, config: {} })).toBeNull();
  });
});

describe("mergeNotificationPrefs", () => {
  const stallOff: NotificationPref = {
    kind: "stall",
    enabled: false,
    config: { afterDays: 20 },
  };

  it("gives every kind at its defaults to a profile with no rows", () => {
    expect(mergeNotificationPrefs([])).toEqual(defaultNotificationPrefs());
  });

  it("lets a stored row win for its own kind and leaves the others at the default", () => {
    const merged = mergeNotificationPrefs([stallOff]);

    expect(merged).toContainEqual(stallOff);
    expect(merged.find((pref) => pref.kind === "weekly_review")).toEqual({
      kind: "weekly_review",
      enabled: true,
      config: { weekday: 0, hour: 18 },
    });
  });

  it("returns the kinds in the declared order, not the order the rows arrived in", () => {
    // Postgres has no reason to hand these back in any particular order, and sorting `kind` there
    // would be alphabetical — the trap this codebase has fallen into twice.
    const merged = mergeNotificationPrefs([stallOff]);

    expect(merged.map((pref) => pref.kind)).toEqual(
      defaultNotificationPrefs().map((pref) => pref.kind),
    );
  });
});
