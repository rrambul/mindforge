import type { PrismaClient } from "@mindforge/db";
import { describe, expect, it, vi } from "vitest";
import { PrismaProfileReader } from "./profile-reader.js";

interface ProfileRow {
  id: string;
  locale: string;
  timezone: string;
  weekStartsOn: number;
}

function readerReturning(row: ProfileRow | null): {
  reader: PrismaProfileReader;
  findUnique: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn().mockResolvedValue(row);
  // Only the one method the reader touches. A full PrismaClient stub would make
  // the test about Prisma's surface rather than about the mapping.
  const prisma = { profile: { findUnique } } as unknown as PrismaClient;
  return { reader: new PrismaProfileReader(prisma), findUnique };
}

const ROW: ProfileRow = {
  id: "11111111-1111-4111-8111-111111111111",
  locale: "pt-BR",
  timezone: "America/Sao_Paulo",
  weekStartsOn: 0,
};

describe("PrismaProfileReader", () => {
  it("maps a row to the auth profile", async () => {
    const { reader } = readerReturning(ROW);
    await expect(reader.findForAuth(ROW.id)).resolves.toEqual({
      userId: ROW.id,
      locale: "pt-BR",
      timezone: "America/Sao_Paulo",
      weekStartsOn: 0,
    });
  });

  it("returns null when the account is gone", async () => {
    const { reader } = readerReturning(null);
    await expect(reader.findForAuth(ROW.id)).resolves.toBeNull();
  });

  it("filters by primary key and selects only what the context needs", async () => {
    // This is the one read in the request path that legitimately bypasses RLS,
    // so the shape of it is the safeguard. An explicit `where` on the id, and no
    // caller-supplied predicate that could widen it.
    const { reader, findUnique } = readerReturning(ROW);
    await reader.findForAuth(ROW.id);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: ROW.id },
      select: { id: true, locale: true, timezone: true, weekStartsOn: true },
    });
  });

  it("degrades a locale we no longer ship to English rather than breaking", async () => {
    // `locale` is a free-text column. A value from a dropped locale or a
    // hand-edited row must not make every response 500.
    const { reader } = readerReturning({ ...ROW, locale: "klingon" });
    await expect(reader.findForAuth(ROW.id)).resolves.toMatchObject({ locale: "en" });
  });

  it("normalises a loosely-spelled locale", async () => {
    const { reader } = readerReturning({ ...ROW, locale: "pt_br" });
    await expect(reader.findForAuth(ROW.id)).resolves.toMatchObject({ locale: "pt-BR" });
  });

  it.each([
    [0, 0],
    [1, 1],
    // The column is a plain integer with no check constraint. Anything that is
    // not Sunday narrows to Monday, because the weekly grid indexes on this and
    // an out-of-range value would produce undefined columns.
    [6, 1],
    [-1, 1],
  ])("narrows week_starts_on %s to %s", async (stored, expected) => {
    const { reader } = readerReturning({ ...ROW, weekStartsOn: stored });
    await expect(reader.findForAuth(ROW.id)).resolves.toMatchObject({ weekStartsOn: expected });
  });
});
