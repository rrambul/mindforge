import { resolveLocale, resolveTimeZone } from "@mindforge/core";
import type { RlsTransaction } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";
import { USER_SCOPED_DB, type UserScopedDb } from "../../../shared/persistence/user-scoped-db.js";
import { resolveTheme, type Profile, type SettingsPatch } from "../domain/profile.js";
import type { ProfileRepository } from "../domain/profile.repository.js";

const COLUMNS = {
  id: true,
  locale: true,
  contentLanguage: true,
  timezone: true,
  weekStartsOn: true,
  theme: true,
  changelogSeenVersion: true,
} as const;

/**
 * Every column a request may write, and the complete list of them.
 *
 * Spelled out rather than derived from the Prisma input type so that adding a column to `profiles`
 * does not silently make it writable from the wire — `created_at` and `id` are not settings.
 */
type ProfileWrite = SettingsPatch & { readonly changelogSeenVersion?: string };

interface ProfileRow {
  id: string;
  locale: string;
  contentLanguage: string;
  timezone: string;
  weekStartsOn: number;
  theme: string;
  changelogSeenVersion: string | null;
}

/**
 * `where: { id: userId }` throughout is the **primary key**, not a scoping predicate.
 *
 * `profiles` is keyed on `id` and its policy is `id = auth.uid()`, so RLS is still what stops this
 * addressing anyone else's row — naming the key is what makes each statement read as "my row"
 * rather than "every row you are allowed to see", which matters a great deal on an UPDATE.
 */
@Injectable()
export class PrismaProfileRepository implements ProfileRepository {
  constructor(@Inject(USER_SCOPED_DB) private readonly db: UserScopedDb) {}

  find(userId: string): Promise<Profile | null> {
    return this.db.run(userId, (tx) => read(tx, userId));
  }

  updateSettings(userId: string, patch: SettingsPatch): Promise<Profile | null> {
    return this.write(userId, { ...patch });
  }

  markChangelogSeen(userId: string, version: string): Promise<Profile | null> {
    return this.write(userId, { changelogSeenVersion: version });
  }

  /**
   * Update then read, inside the one transaction `db.run` already opens.
   *
   * `updateMany` rather than `update`: Prisma's `update` throws P2025 when the row is not there,
   * which would turn "your account was deleted mid-request" into a 500 on the way to telling you it
   * no longer exists. This reports it as null and the use case names it.
   *
   * The read is in the same transaction as the write, so the returned row is the one this statement
   * produced rather than whatever a concurrent tab left behind a millisecond later.
   */
  private write(userId: string, data: ProfileWrite): Promise<Profile | null> {
    return this.db.run(userId, async (tx) => {
      await tx.profile.updateMany({ where: { id: userId }, data });
      return read(tx, userId);
    });
  }
}

/** Shared by the read and the write so both agree on which columns a `Profile` is made of. */
async function read(tx: RlsTransaction, userId: string): Promise<Profile | null> {
  const row = await tx.profile.findUnique({ where: { id: userId }, select: COLUMNS });
  return row ? toProfile(row) : null;
}

function toProfile(row: ProfileRow): Profile {
  return {
    userId: row.id,
    // Coerced rather than trusted, the same way `PrismaProfileReader` does it for the narrower
    // context the auth guard builds. These are free-text columns: a locale we no longer ship or a
    // zone the IANA database dropped has to degrade to something renderable, because the SPA reads
    // all of this before it paints and `Intl` throws on an unknown zone rather than falling back.
    locale: resolveLocale(row.locale),
    contentLanguage: resolveLocale(row.contentLanguage),
    timezone: resolveTimeZone(row.timezone),
    weekStartsOn: row.weekStartsOn === 0 ? 0 : 1,
    theme: resolveTheme(row.theme),
    changelogSeenVersion: row.changelogSeenVersion,
  };
}
