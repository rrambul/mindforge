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

  "error.resource.not_found": "That resource no longer exists.",
  "error.resource.link_target_missing":
    "{kind, select, mission {That mission} skill {That skill} other {That}} no longer exists.",
  "error.resource.no_progress": "This kind of resource isn't measured in units.",
  "error.friction.not_found": "That friction event no longer exists.",
  "error.friction.target_missing":
    "{kind, select, skill {That skill} resource {That resource} other {That}} no longer exists.",
  "error.focus.in_future": "That time is in the future — check the date, or your device's clock.",
  "error.skill.not_found": "That skill no longer exists.",
  "error.skill.prerequisite_cycle":
    "That would make the two skills depend on each other, so neither could ever come first.",
  "error.skill.self_prerequisite": "A skill can't be its own prerequisite.",
  "error.skill.name_taken": "You already have a skill with that name.",
  "error.goal.not_found": "That goal no longer exists.",
  "error.goal.target_not_found": "That target no longer exists.",
  "error.goal.already_closed": "That goal is already closed. Reopen it first.",
  "error.goal.not_closed": "That goal is still active.",
  "error.goal.target_not_manual":
    "This target is worked out from your evidence, so it can't be set by hand.",
  "error.goal.subject_missing":
    "{subject, select, resource {That resource} skill {That skill} mission {That mission} other {That}} no longer exists.",
  "error.resource.progress_out_of_range":
    "{total, plural, =0 {That position isn't valid.} other {This has # {unit}, so that position isn't valid.}}",
  /**
   * The weekly plan (FR-F5). Parking a mission is a statement that you are not working on it, so
   * allocating hours to a parked one is a contradiction rather than an oversight — §5.3 excludes
   * parked missions from allocation and from plan-vs-actual alike.
   */
  "error.planning.subject_missing": "That mission or skill no longer exists.",
  "error.planning.mission_parked":
    "That mission is parked. Unpark it before planning time against it.",
  "error.planning.duplicate_subject": "That mission or skill appears twice in this week's plan.",
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

  "error.resource.not_found": "Esse recurso não existe mais.",
  "error.resource.link_target_missing":
    "{kind, select, mission {Essa missão} skill {Essa habilidade} other {Isso}} não existe mais.",
  "error.resource.no_progress": "Esse tipo de recurso não é medido em unidades.",
  "error.friction.not_found": "Esse registro de atrito não existe mais.",
  "error.friction.target_missing":
    "{kind, select, skill {Essa habilidade} resource {Esse recurso} other {Isso}} não existe mais.",
  "error.focus.in_future":
    "Esse horário está no futuro — confira a data, ou o relógio do seu dispositivo.",
  "error.skill.not_found": "Essa habilidade não existe mais.",
  "error.skill.prerequisite_cycle":
    "Isso faria as duas habilidades dependerem uma da outra, então nenhuma poderia vir primeiro.",
  "error.skill.self_prerequisite": "Uma habilidade não pode ser pré-requisito de si mesma.",
  "error.skill.name_taken": "Você já tem uma habilidade com esse nome.",
  "error.goal.not_found": "Essa meta não existe mais.",
  "error.goal.target_not_found": "Esse alvo não existe mais.",
  "error.goal.already_closed": "Essa meta já está encerrada. Reabra antes.",
  "error.goal.not_closed": "Essa meta ainda está ativa.",
  "error.goal.target_not_manual":
    "Este alvo é calculado a partir das suas evidências, então não pode ser definido à mão.",
  "error.goal.subject_missing":
    "{subject, select, resource {Esse recurso} skill {Essa habilidade} mission {Essa missão} other {Isso}} não existe mais.",
  "error.resource.progress_out_of_range":
    "{total, plural, =0 {Essa posição não é válida.} other {Isto tem # {unit}, então essa posição não é válida.}}",
  "error.planning.subject_missing": "Essa missão ou habilidade não existe mais.",
  "error.planning.mission_parked":
    "Essa missão está pausada. Retome antes de planejar tempo para ela.",
  "error.planning.duplicate_subject":
    "Essa missão ou habilidade aparece duas vezes no plano da semana.",
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
