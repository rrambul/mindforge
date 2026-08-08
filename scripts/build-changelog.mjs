import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * `CHANGELOG.md` → `apps/web/public/changelog.json`, for Settings → What's new (§14.1).
 *
 * **The Markdown is the source and stays the source.** §14.1 is explicit that entries are written for
 * a reader rather than derived from commit subjects — release-please produces the skeleton and the
 * release PR is where it becomes sentences. Two copies of that prose would drift the first time
 * somebody edited the one they had open, so the SPA reads a build artifact of the same file.
 *
 * **Not an API endpoint.** The changelog is the same for every user, it changes only when a release
 * ships, and serving it from the SPA's own origin means the screen renders with no round trip and
 * works offline like the rest of the shell. An endpoint would be a database read of a constant.
 *
 * **Not a locale bundle either.** It would have to pass `check:i18n`, which compares keys across
 * locales — so every English entry would need a pt-BR twin before the build would go green, and a
 * release would be blocked on translating its own release notes. The screen renders whatever
 * language the entries were written in, which is honest about what it is.
 */

const ROOT = new URL("../", import.meta.url);
const SOURCE = fileURLToPath(new URL("CHANGELOG.md", ROOT));
const TARGET = fileURLToPath(new URL("apps/web/public/changelog.json", ROOT));

/** `## 1.2.3` or `## [1.2.3](link) (2026-08-07)` — release-please emits the second shape. */
const HEADING =
  /^##\s+\[?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\]?(?:\([^)]*\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/u;

async function main() {
  const markdown = await readFile(SOURCE, "utf8");
  const releases = [];
  let current = null;

  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? null, body: [] };
      releases.push(current);
      continue;
    }
    // Everything before the first version heading is the file's own preamble — an explanation of how
    // the changelog is written, which is for whoever edits it and not for the app.
    if (current !== null) current.body.push(line);
  }

  const payload = releases.map((release) => ({
    version: release.version,
    date: release.date,
    // Markdown, rendered by the screen. Kept as one string rather than split into bullets because
    // the entries have sub-headings and prose paragraphs, and flattening those to a list would lose
    // the structure that makes them readable.
    body: release.body.join("\n").trim(),
  }));

  await writeFile(TARGET, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(
    `changelog.json: ${payload.length} release${payload.length === 1 ? "" : "s"}, newest ${payload[0]?.version ?? "none"}\n`,
  );
}

await main();
