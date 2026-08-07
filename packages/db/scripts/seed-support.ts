import { dayBounds, localDay, resolveTimeZone, type IsoDate } from "@mindforge/core";
import { createPrismaClient, type PrismaClient } from "../src/index.js";

/**
 * Shared machinery for `seed:minimal` and `seed:rich`.
 *
 * Both scripts were declared in `package.json` from M0 and neither existed, which meant
 * `prisma migrate dev` failed at its seed step and TECH-DESIGN §14's "the activity grid and insights
 * are unbuildable against an empty database" stayed true right up to the milestone that needed them.
 *
 * Three properties everything here is built around:
 *
 * 1. **Deterministic.** A seeded PRNG, never `Math.random()`. Re-running produces byte-identical
 *    data, so "the grid looks wrong" is a bug report somebody else can reproduce rather than a
 *    story about a database that no longer exists.
 * 2. **Idempotent.** Every run deletes the seeded user's rows first. Seeding twice gives you the
 *    same account, not two overlapping histories.
 * 3. **Signed-in-able.** The user is created through Supabase's admin API with a real password, so
 *    the account it produces is one you can actually log into. Inserting straight into `auth.users`
 *    the way the RLS tests do is faster and gives you an account with no way in.
 */

/**
 * mulberry32 — small, fast, and good enough for fixtures.
 *
 * Explicitly not a cryptographic generator and never used as one. What matters is that the same
 * seed gives the same sequence on every machine, which `Math.random()` cannot promise.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Random {
  /** 0 ≤ n < max. */
  int(max: number): number;
  /** min ≤ n ≤ max. */
  between(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

export function random(seed: number): Random {
  const next = rng(seed);
  const int = (max: number): number => Math.floor(next() * max);
  return {
    int,
    between: (min, max) => min + int(max - min + 1),
    pick: (items) => items[int(items.length)]!,
    chance: (p) => next() < p,
  };
}

export interface SeedOptions {
  readonly email: string;
  readonly password: string;
  readonly timezone: string;
  /** The last day the seed generates. Defaults to today in `timezone`. */
  readonly today: IsoDate;
}

/**
 * Command-line options, with defaults that work with no arguments.
 *
 * `--today` exists so a fixture can be pinned to a date. Without it the seed anchors on the real
 * clock, which is what you want when you are about to look at a "last 28 days" figure.
 */
export function parseOptions(argv: readonly string[]): SeedOptions {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([\w-]+)=(.*)$/u.exec(arg);
    if (match) flags.set(match[1]!, match[2]!);
  }

  const timezone = resolveTimeZone(flags.get("timezone") ?? "America/Sao_Paulo");
  return {
    email: flags.get("email") ?? "dev@mindforge.local",
    password: flags.get("password") ?? "mindforge-dev",
    timezone,
    // `Date.now()` rather than a bare `new Date()`: the repo-wide lint rule bans the argless form
    // because it makes timezone-derived code untestable, and a seed is the one place that genuinely
    // means "right now".
    today: flags.get("today") ?? localDay(new Date(Date.now()), timezone),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set. Copy .env.local to packages/db/.env — see .env.example for the shape.`,
    );
  }
  return value;
}

/**
 * Create the account through Supabase's admin API, or find it if it is already there.
 *
 * Plain `fetch` rather than `@supabase/supabase-js`, which is not a dependency of this package and
 * would be one for four lines of HTTP.
 */
export async function provisionUser(email: string, password: string): Promise<string> {
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };

  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (created.ok) {
    const body = (await created.json()) as { id: string };
    return body.id;
  }

  // Already exists — the idempotent path, and the common one after the first run.
  const found = await fetch(`${url}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers,
  });
  if (!found.ok) {
    throw new Error(`Could not create or find ${email}: ${created.status} ${await created.text()}`);
  }
  const body = (await found.json()) as { users: { id: string; email: string }[] };
  const user = body.users.find((u) => u.email === email);
  if (!user) throw new Error(`Supabase reported no user for ${email} and would not create one`);
  return user.id;
}

/**
 * Everything this user owns, gone.
 *
 * Ordered children-first rather than relying on cascades, so the script says out loud what it
 * destroys. `profiles` is left alone: the signup trigger owns that row, and deleting it would take
 * the auth user's shadow with it.
 */
export async function wipeUser(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.dailyActivity.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.notificationPref.deleteMany({ where: { userId } }),
    prisma.weeklyReview.deleteMany({ where: { userId } }),
    prisma.weeklyAllocation.deleteMany({ where: { userId } }),
    prisma.weeklyPlan.deleteMany({ where: { userId } }),
    prisma.frictionEvent.deleteMany({ where: { userId } }),
    prisma.focusSession.deleteMany({ where: { userId } }),
    prisma.note.deleteMany({ where: { userId } }),
    prisma.task.deleteMany({ where: { userId } }),
    prisma.resourceLink.deleteMany({ where: { userId } }),
    prisma.resource.deleteMany({ where: { userId } }),
    prisma.goalTarget.deleteMany({ where: { userId } }),
    prisma.goal.deleteMany({ where: { userId } }),
    prisma.skillEdge.deleteMany({ where: { userId } }),
    prisma.skill.deleteMany({ where: { userId } }),
    prisma.missionRevision.deleteMany({ where: { userId } }),
    prisma.mission.deleteMany({ where: { userId } }),
  ]);
}

/** Sets the profile fields the signup trigger cannot know. */
export async function configureProfile(
  prisma: PrismaClient,
  userId: string,
  options: SeedOptions,
): Promise<void> {
  await prisma.profile.update({
    where: { id: userId },
    data: {
      timezone: options.timezone,
      // pt-BR interface, English lessons — the combination §5.2 says is legitimate and likely, and
      // the one that would expose a screen that assumed the two move together.
      locale: "pt-BR",
      contentLanguage: "en",
      weekStartsOn: 0,
    },
  });
}

export function connect(): PrismaClient {
  // Prisma 7 does not auto-load .env, and a seed is usually the first thing run in a fresh clone.
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
  } catch {
    // Already in the environment, which is how CI and Railway supply it.
  }
  return createPrismaClient(requireEnv("DATABASE_URL"));
}

/**
 * An instant `hour:minute` into the local day `day`.
 *
 * Measured from the day's own start rather than assembled from a UTC string, so the zone's offset —
 * including a three-quarter-hour one — is already accounted for. Clamped to the day's end, which
 * matters exactly twice a year: on a 23-hour day, 23:30 does not exist, and the clamp puts the
 * session in the last minute of the day it belongs to instead of spilling into the next cell.
 *
 * Not exported as a general-purpose helper. On a spring-forward day this reads one hour later on
 * the wall than asked for, which is fine for a fixture and would not be fine for a scheduler.
 */
export function at(day: IsoDate, hour: number, minute: number, timeZone: string): Date {
  const { start, end } = dayBounds(day, timeZone);
  const wanted = start.getTime() + hour * 3_600_000 + minute * 60_000;
  return new Date(Math.min(wanted, end.getTime() - 60_000));
}
