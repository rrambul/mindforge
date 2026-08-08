import { resolveLocale, type Locale, type WeekStart } from "@mindforge/core";
import type { PrismaClient } from "@mindforge/db";
import { Inject, Injectable } from "@nestjs/common";
import { PRISMA } from "../persistence/user-scoped-db.js";

export interface AuthProfile {
  readonly userId: string;
  readonly locale: Locale;
  /**
   * What the agent writes in, and what stems a note's search column (FR-L4).
   *
   * Separate from `locale` because §5.2 keeps them separate, and because the notes controller was
   * passing the UI locale where the *content* language belonged: a pt-BR interface writing English
   * notes stored `lang='portuguese'`, the generated tsvector used the Portuguese stemmer, and
   * searching "running" stopped matching "run". `CreateNoteSchema`'s own docstring names that exact
   * inversion as the thing it exists to prevent.
   */
  readonly contentLanguage: Locale;
  readonly timezone: string;
  readonly weekStartsOn: WeekStart;
}

export interface ProfileReader {
  findForAuth(userId: string): Promise<AuthProfile | null>;
}

export const PROFILE_READER = Symbol("ProfileReader");

/**
 * The one read that legitimately bypasses RLS.
 *
 * It has to: the guard needs the profile *in order to* build the request context,
 * and `runAsUser` needs a user id to set claims with. Reading your own row
 * through a policy that authorises it using the row you have not read yet is
 * circular.
 *
 * So this goes through the base client with an explicit primary-key filter, which
 * is exactly the discipline the worker will live under (TECH-DESIGN.md §3.6). It
 * is deliberately the *only* such read in the request path, it selects only what
 * the context needs, and it cannot be widened by accident because there is no
 * caller-supplied predicate to widen.
 */
@Injectable()
export class PrismaProfileReader implements ProfileReader {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async findForAuth(userId: string): Promise<AuthProfile | null> {
    const row = await this.prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, locale: true, contentLanguage: true, timezone: true, weekStartsOn: true },
    });
    if (!row) return null;

    return {
      userId: row.id,
      // Coerced rather than trusted. The column is free text, and a locale we no
      // longer ship must degrade to English rather than break every response.
      locale: resolveLocale(row.locale),
      contentLanguage: resolveLocale(row.contentLanguage),
      timezone: row.timezone,
      weekStartsOn: row.weekStartsOn === 0 ? 0 : 1,
    };
  }
}
