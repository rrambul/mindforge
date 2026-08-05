#!/usr/bin/env node
/**
 * FR-L7: a missing translation key fails the build, rather than rendering a raw key
 * to the user.
 *
 * Every namespace must exist in every locale, and every leaf key must exist in all of
 * them. Checked in both directions — a key present only in pt-BR is just as broken as
 * one present only in `en`, and the asymmetric version of this check is how a locale
 * quietly accumulates dead strings.
 *
 * ICU placeholders are compared too. `{limit}` in one locale and `{max}` in the other
 * type-checks, passes a key-only comparison, and renders the literal text `{max}` to
 * whichever user reads that language.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const localesDir = new URL("../apps/web/src/locales/", import.meta.url).pathname;

/** Flattens to dotted paths so a nested object and a string cannot silently swap. */
function flatten(value, prefix = "", out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

/**
 * Argument names only — not the branch bodies of a `plural` or `select`, which differ by
 * design: English has two plural forms, Portuguese's rules are its own, and a `select`
 * branch body is translated prose.
 *
 * This needs a real (if small) parse rather than a regex. `/\{\s*(\w+)/g` looks like it
 * does the job and does not: in `{unit, select, page {Page} other {Progress}}` it reports
 * `Page` and `Progress` as arguments, so translating them — which is the entire point of
 * having them — reads as a mismatch. It only appeared to work on `plural` because those
 * bodies conventionally start with `#`, which is not an identifier character.
 */
function placeholders(message) {
  if (typeof message !== "string") return new Set();
  const names = new Set();
  collectArguments(message, 0, message.length, names);
  return names;
}

const SUBMESSAGE_TYPES = new Set(["plural", "select", "selectordinal"]);

/** Walks text, recursing into every `{...}` it finds. */
function collectArguments(text, start, end, names) {
  let index = start;

  while (index < end) {
    const char = text[index];

    if (char === "'") {
      index = skipQuoted(text, index, end);
      continue;
    }
    if (char !== "{") {
      index += 1;
      continue;
    }

    const close = matchingBrace(text, index, end);
    readArgument(text, index + 1, close, names);
    index = close + 1;
  }
}

/**
 * One `{...}`: records its name, and for a submessage recurses into each branch body so a
 * nested argument is still found, while the branch *keys* are ignored.
 */
function readArgument(text, start, end, names) {
  const comma = indexOfTopLevel(text, ",", start, end);
  const nameEnd = comma === -1 ? end : comma;
  const name = text.slice(start, nameEnd).trim();

  // An empty name is malformed ICU; formatjs will reject it at runtime with a better message
  // than this script could give, so it is not this check's business.
  if (name !== "") names.add(name);
  if (comma === -1) return;

  const typeStart = comma + 1;
  const typeComma = indexOfTopLevel(text, ",", typeStart, end);
  const type = text.slice(typeStart, typeComma === -1 ? end : typeComma).trim();

  // `number`, `date`, and `time` are followed by a style, not by branches — nothing to recurse into.
  if (!SUBMESSAGE_TYPES.has(type) || typeComma === -1) return;

  collectBranches(text, typeComma + 1, end, names);
}

/**
 * The `key {body} key {body}` tail of a submessage.
 *
 * Each `{...}` here is a *body*, not an argument, so this recurses into the interior rather
 * than reading it as one — the distinction is the whole reason a regex cannot do this job. The
 * keys between the groups (`one`, `other`, `page`) are skipped: they are ICU vocabulary and a
 * `select` key is a domain enum value, neither of which is ever translated.
 */
function collectBranches(text, start, end, names) {
  let index = start;

  while (index < end) {
    if (text[index] === "'") {
      index = skipQuoted(text, index, end);
      continue;
    }
    if (text[index] !== "{") {
      index += 1;
      continue;
    }

    const close = matchingBrace(text, index, end);
    collectArguments(text, index + 1, close, names);
    index = close + 1;
  }
}

/** The index of the `{` group's matching `}`, or `end` if the message is unbalanced. */
function matchingBrace(text, open, end) {
  let depth = 0;
  for (let index = open; index < end; index += 1) {
    const char = text[index];
    if (char === "'") {
      index = skipQuoted(text, index, end) - 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return end;
}

function indexOfTopLevel(text, needle, start, end) {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const char = text[index];
    if (char === "'") {
      index = skipQuoted(text, index, end) - 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === needle && depth === 0) return index;
  }
  return -1;
}

/**
 * ICU quoting: a `'` escapes only when it precedes `{`, `}`, or `#`, and `''` is a literal
 * apostrophe. Everywhere else — "isn't", "what's" — it is just a character, which is why this
 * returns the next index rather than hunting for a closing quote that was never opened.
 */
function skipQuoted(text, index, end) {
  const next = text[index + 1];
  if (next === "'") return index + 2;
  if (next !== "{" && next !== "}" && next !== "#") return index + 1;

  const close = text.indexOf("'", index + 2);
  return close === -1 ? end : close + 1;
}

async function readLocale(locale) {
  const dir = join(localesDir, locale);
  const namespaces = new Map();
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = await readFile(join(dir, file), "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      // `cause` kept, not just its message: a JSON syntax error carries the offset, and
      // dropping it means hunting for the comma by eye.
      throw new Error(`${locale}/${file} is not valid JSON`, { cause });
    }
    namespaces.set(file.replace(/\.json$/, ""), flatten(parsed));
  }
  return namespaces;
}

async function main() {
  const locales = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (locales.length < 2) {
    console.error(`Expected at least two locales in apps/web/src/locales, found: ${locales}`);
    process.exitCode = 1;
    return;
  }

  const bundles = new Map();
  for (const locale of locales) bundles.set(locale, await readLocale(locale));

  const problems = [];
  const allNamespaces = new Set([...bundles.values()].flatMap((ns) => [...ns.keys()]));

  for (const namespace of [...allNamespaces].sort()) {
    const present = locales.filter((locale) => bundles.get(locale).has(namespace));
    if (present.length !== locales.length) {
      problems.push(
        `namespace "${namespace}" exists only in ${present.join(", ")} — expected all of ${locales.join(", ")}`,
      );
      continue;
    }

    const keysByLocale = new Map(
      locales.map((locale) => [locale, bundles.get(locale).get(namespace)]),
    );
    const allKeys = new Set([...keysByLocale.values()].flatMap((keys) => [...keys.keys()]));

    for (const key of [...allKeys].sort()) {
      const holders = locales.filter((locale) => keysByLocale.get(locale).has(key));
      if (holders.length !== locales.length) {
        const missing = locales.filter((locale) => !holders.includes(locale));
        problems.push(`${namespace}:${key} missing from ${missing.join(", ")}`);
        continue;
      }

      const [reference, ...rest] = locales;
      const expected = placeholders(keysByLocale.get(reference).get(key));
      for (const locale of rest) {
        const actual = placeholders(keysByLocale.get(locale).get(key));
        const missing = [...expected].filter((name) => !actual.has(name));
        const extra = [...actual].filter((name) => !expected.has(name));
        if (missing.length > 0 || extra.length > 0) {
          problems.push(
            `${namespace}:${key} placeholder mismatch — ${reference} has {${[...expected].join(", ")}}, ` +
              `${locale} has {${[...actual].join(", ")}}`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\nTranslation bundles disagree (${problems.length}):\n`);
    for (const problem of problems) console.error(`  ✖ ${problem}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  const keyCount = [...bundles.get(locales[0]).values()].reduce((sum, keys) => sum + keys.size, 0);
  console.log(`i18n bundles agree: ${keyCount} keys × ${locales.length} locales.`);
}

await main();
