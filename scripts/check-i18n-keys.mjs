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
 * Placeholder names only — not the plural bodies, which differ by design: English has
 * two plural forms and Portuguese's rules are its own.
 */
function placeholders(message) {
  if (typeof message !== "string") return new Set();
  const names = new Set();
  for (const match of message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)) {
    names.add(match[1]);
  }
  return names;
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
