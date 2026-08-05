/**
 * Server-side user-facing strings.
 *
 * These live in `packages/core` rather than in `apps/api` for one reason
 * (TECH-DESIGN.md §5.2): they are resolved from the user's **stored** locale,
 * not from a request header. An `Accept-Language` header describes the browser
 * that happens to be making the request; a background job that emails you has
 * no header at all, and a `detail` string rendered in the wrong language on a
 * mobile share-target request is a bug the header approach cannot avoid.
 *
 * The RFC 7807 contract (§6.1) splits the shape precisely: `detail` is
 * user-facing and translated, while `type` and `errors[].code` are stable
 * machine keys and are never translated. Only the first kind belongs here.
 *
 * FR-L7 — a missing translation key fails the build — is enforced by the type
 * system rather than a lint pass: `ServerMessageKey` is derived from the `en`
 * catalog, and `CATALOG` is typed so every locale must supply every key. Adding
 * an English string without its pt-BR counterpart does not compile.
 */

import { IntlMessageFormat } from "intl-messageformat";
import type { Locale } from "./locales.js";

/**
 * English is the source of truth for the key set. Ordered by area, not
 * alphabetically, so a reviewer reads related copy together.
 */
const EN = {
  "error.unauthenticated": "Sign in to continue.",
  "error.forbidden": "You don't have access to this.",
  "error.validation_failed": "Some fields need fixing.",
  "error.not_found": "We couldn't find that.",
  /**
   * The catch-all for a 4xx with no more specific copy — an oversized upload, a
   * method that route doesn't take. Deliberately does not say "nothing you did
   * caused this": that sentence belongs only to 5xx, and attaching it to a 4xx
   * would be the app stating something false about whose fault it is.
   */
  "error.bad_request": "That request couldn't be processed.",
  "error.internal": "Something went wrong on our end. Nothing you did caused this.",

  "error.mission.not_found": "That mission no longer exists.",
  "error.mission.wip_limit":
    "You have {limit, plural, one {# active mission} other {# active missions}}. " +
    "Park one before starting another.",
  "error.mission.not_active": "Only an active mission can be parked.",
  "error.mission.not_parked": "Only a parked mission can be resumed.",

  "error.focus.not_found": "That focus session no longer exists.",
  "error.focus.already_running": "A focus session is already running. Stop it first.",
  "error.focus.not_running": "That session has already been stopped.",
  "error.focus.not_stopped": "Stop the session before writing its debrief.",

  "error.note.not_found": "That note no longer exists.",
} as const;

export type ServerMessageKey = keyof typeof EN;

/**
 * "Park" is rendered as *pausar*. Like the temper band names (TECH-DESIGN.md
 * §5.2), it is a product concept rather than UI chrome, and the literal
 * *estacionar* reads absurdly in Portuguese. This is a considered guess and
 * deserves a native speaker's confirmation before it is final.
 */
const PT_BR: Readonly<Record<ServerMessageKey, string>> = {
  "error.unauthenticated": "Entre para continuar.",
  "error.forbidden": "Você não tem acesso a isso.",
  "error.validation_failed": "Alguns campos precisam de ajuste.",
  "error.not_found": "Não encontramos isso.",
  "error.bad_request": "Não foi possível processar essa requisição.",
  "error.internal": "Algo deu errado do nosso lado. Não foi nada que você fez.",

  "error.mission.not_found": "Essa missão não existe mais.",
  "error.mission.wip_limit":
    "Você tem {limit, plural, one {# missão ativa} other {# missões ativas}}. " +
    "Pause uma antes de começar outra.",
  "error.mission.not_active": "Só uma missão ativa pode ser pausada.",
  "error.mission.not_parked": "Só uma missão pausada pode ser retomada.",

  "error.focus.not_found": "Essa sessão de foco não existe mais.",
  "error.focus.already_running": "Já existe uma sessão de foco em andamento. Pare ela primeiro.",
  "error.focus.not_running": "Essa sessão já foi encerrada.",
  "error.focus.not_stopped": "Encerre a sessão antes de escrever o debrief.",

  "error.note.not_found": "Essa nota não existe mais.",
};

const CATALOG: Readonly<Record<Locale, Readonly<Record<ServerMessageKey, string>>>> = {
  en: EN,
  "pt-BR": PT_BR,
};

/** ICU's `PrimitiveType`, restated so callers don't import from the library. */
export type MessageVars = Readonly<Record<string, string | number | boolean | Date | null>>;

/**
 * Compiling an ICU message parses it; doing that per request for a fixed
 * catalog is pure waste. The cache is unbounded on purpose — it is bounded in
 * practice by `locales × keys`, which is a compile-time constant.
 */
const compiled = new Map<string, IntlMessageFormat>();

/**
 * `|` appears in neither a locale tag nor a message key, so it cannot collide.
 * Printable on purpose: a control character here made the whole file read as
 * binary to git, which cost it its diff and its blame.
 */
const CACHE_KEY_SEPARATOR = "|";

function formatterFor(locale: Locale, key: ServerMessageKey): IntlMessageFormat {
  const cacheKey = `${locale}${CACHE_KEY_SEPARATOR}${key}`;
  const hit = compiled.get(cacheKey);
  if (hit) return hit;

  const formatter = new IntlMessageFormat(CATALOG[locale][key], locale);
  compiled.set(cacheKey, formatter);
  return formatter;
}

/**
 * Render a server-side string in the user's locale.
 *
 * `locale` is required rather than defaulted: every call site has a user whose
 * preference is known, and an optional parameter here is an invitation to
 * quietly ship English to a Portuguese-speaking user.
 */
export function formatServerMessage(
  locale: Locale,
  key: ServerMessageKey,
  vars?: MessageVars,
): string {
  // Every string in the catalog is plain text — no XML tags, no rich-text
  // callbacks — so `format` returns a string rather than a parts array. The
  // cast records that invariant, and `formats every catalogued message as a
  // string` in the test suite proves it instead of trusting it.
  return formatterFor(locale, key).format(vars ?? undefined) as string;
}

/** Exposed for the completeness test, and for tooling that audits the catalog. */
export const SERVER_MESSAGE_KEYS = Object.keys(EN) as readonly ServerMessageKey[];

export function serverMessageSource(locale: Locale, key: ServerMessageKey): string {
  return CATALOG[locale][key];
}
