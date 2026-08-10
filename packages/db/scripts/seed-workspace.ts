/**
 * Putting real files behind the seeded rows.
 *
 * `seed:rich` has always written `lessons.storage_path` and stopped there, which was
 * fine while nothing read a lesson. M5 reads them: the reader resolves that path
 * through the lessons origin, so a seed with no objects behind it produces a
 * curriculum full of lessons that all 404 — a screen that looks broken while the
 * data is perfectly correct.
 *
 * **Best effort, and loud about it.** The seed's one requirement is a database, and
 * Storage credentials are a second thing to have. Without them the rows are still
 * written and the caller is told, in one line, exactly which screen will be empty.
 * Failing the whole seed over it would make `seed:rich` unusable for the tracker
 * work it was written for.
 *
 * Plain `fetch` rather than `@supabase/supabase-js`: this is one PUT per file, and a
 * seed script is not worth a dependency that the package it lives in does not
 * otherwise have.
 */

const BUCKET = "mindforge";

export interface WorkspaceUploader {
  put(path: string, body: string, contentType: string): Promise<void>;
  readonly written: number;
}

/**
 * Null when the environment has no Storage credentials — the caller prints why.
 *
 * The service-role key is what this needs: the workspace bucket has no policies at
 * all (`20260808150000_workspace_bucket`), so nothing else can write to it.
 */
export function workspaceUploader(env: NodeJS.ProcessEnv = process.env): WorkspaceUploader | null {
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;

  const base = `${url.replace(/\/$/u, "")}/storage/v1/object/${BUCKET}`;
  const state = { written: 0 };

  return {
    get written() {
      return state.written;
    },
    async put(path: string, body: string, contentType: string): Promise<void> {
      const response = await fetch(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          apikey: key,
          "content-type": contentType,
          // Upsert, because re-seeding is the normal case and a seed that refused
          // to overwrite would need a wipe step nobody would remember to run.
          "x-upsert": "true",
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`Storage refused ${path}: ${response.status} ${await response.text()}`);
      }
      state.written += 1;
    },
  };
}

/**
 * A lesson, in the shape the teach skill writes them (§7.2).
 *
 * Self-contained HTML with inline script and inline style — that is what a real
 * generated lesson is, and it is why the reader sandboxes them. The little
 * check-your-understanding widget is not decoration: it means the seeded content
 * exercises the same thing a real lesson does, so a CSP or sandbox mistake shows up
 * against seed data rather than waiting for a $1.47 agent run to find it.
 *
 * The `<meta>` tags are the ones the reindexer reads (FR-T4). A seeded file that
 * omitted them would not survive a real reindex of the same workspace.
 */
export function lessonHtml(input: {
  readonly title: string;
  readonly trackSlug: string;
  readonly lessonSlug: string;
  readonly intent: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="mindforge:track" content="${escapeHtml(input.trackSlug)}" />
    <meta name="mindforge:lesson" content="${escapeHtml(input.lessonSlug)}" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 42rem; }
      h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
      .intent { color: #555; margin: 0 0 1.5rem; }
      button { font: inherit; padding: 0.5rem 0.9rem; }
      output { display: block; margin-top: 0.75rem; min-height: 1.6em; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="intent">${escapeHtml(input.intent)}</p>

    <p>
      Seeded content. A real lesson here is written by the teach agent, one at a time,
      and is HTML with whatever interactive parts the material needs.
    </p>

    <h2>Check yourself</h2>
    <p>Does this lesson's own JavaScript run inside the reader?</p>
    <button id="check" type="button">It should</button>
    <output id="answer"></output>

    <script>
      document.getElementById("check").addEventListener("click", function () {
        document.getElementById("answer").textContent =
          "Yes — and it cannot reach the network, read the app's session, or leave this frame.";
      });
    </script>
  </body>
</html>
`;
}

/** A reference document — the kind of thing the skill says you come back to. */
export function referenceHtml(title: string, mission: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font: 16px/1.6 system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 42rem; }
      dt { font-weight: 600; margin-top: 1rem; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>Seeded reference for ${escapeHtml(mission)} — the sort of page you keep open beside the work.</p>
    <dl>
      <dt>Why this is separate from a lesson</dt>
      <dd>A lesson you do once. This you come back to.</dd>
      <dt>Who writes it</dt>
      <dd>The teach agent, when a lesson produces something worth keeping.</dd>
    </dl>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
