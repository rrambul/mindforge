import { describe, expect, it } from "vitest";
import { SeenChangelogSchema, ThemeSchema, UpdateProfileSchema } from "./profile.js";

describe("UpdateProfileSchema", () => {
  it("accepts a single field, leaving the rest unchanged", () => {
    // A PATCH, not a PUT: a settings form that sent the whole object would silently revert whatever
    // a second tab changed in the meantime.
    expect(UpdateProfileSchema.parse({ timezone: "America/Sao_Paulo" })).toEqual({
      timezone: "America/Sao_Paulo",
    });
  });

  it("refuses a patch that changes nothing", () => {
    expect(UpdateProfileSchema.safeParse({}).success).toBe(false);
  });

  it("validates the timezone against Intl rather than a list", () => {
    // The IANA database gains and loses zones. A hardcoded list in this file would be wrong within
    // a year, and wrong in the direction of rejecting somebody's real timezone.
    expect(UpdateProfileSchema.safeParse({ timezone: "Pacific/Chatham" }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ timezone: "Asia/Kathmandu" }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ timezone: "Mars/Olympus_Mons" }).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({ timezone: "" }).success).toBe(false);
  });

  it("keeps content language separate from interface locale", () => {
    // A pt-BR interface with English lessons is a legitimate and likely combination (FR-L3).
    expect(UpdateProfileSchema.parse({ locale: "pt-BR", contentLanguage: "en" })).toEqual({
      locale: "pt-BR",
      contentLanguage: "en",
    });
  });

  it("refuses a locale we do not ship", () => {
    expect(UpdateProfileSchema.safeParse({ locale: "fr" }).success).toBe(false);
  });

  it("takes week start as its own field rather than deriving it from locale", () => {
    // Seeded from locale at signup, owned by the user afterwards (FR-L5) — so switching the
    // interface to English must not silently re-bucket last quarter's weeks.
    expect(UpdateProfileSchema.parse({ weekStartsOn: 0 })).toEqual({ weekStartsOn: 0 });
    expect(UpdateProfileSchema.parse({ weekStartsOn: 1 })).toEqual({ weekStartsOn: 1 });
    expect(UpdateProfileSchema.safeParse({ weekStartsOn: 2 }).success).toBe(false);
  });

  it("accepts both themes and nothing else", () => {
    expect(ThemeSchema.safeParse("dark").success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ theme: "sepia" }).success).toBe(false);
  });
});

describe("SeenChangelogSchema", () => {
  it("accepts a SemVer version", () => {
    expect(SeenChangelogSchema.parse({ version: "1.2.3" })).toEqual({ version: "1.2.3" });
    expect(SeenChangelogSchema.safeParse({ version: "1.2.3-rc.1" }).success).toBe(true);
    expect(SeenChangelogSchema.safeParse({ version: "1.2.3+build.7" }).success).toBe(true);
  });

  it("refuses anything that is not one", () => {
    expect(SeenChangelogSchema.safeParse({ version: "v1.2.3" }).success).toBe(false);
    expect(SeenChangelogSchema.safeParse({ version: "1.2" }).success).toBe(false);
    expect(SeenChangelogSchema.safeParse({ version: "latest" }).success).toBe(false);
  });
});
