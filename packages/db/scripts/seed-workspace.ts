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
    <!--
      The shared stylesheet, linked the way a real lesson links it: the skill calls
      it "the first component every workspace earns", so every lesson wears the
      same clothes rather than inventing its own. It is also the reason the grant
      covers a workspace and not a file — this relative link resolves back inside
      the same grant, and if it did not, every seeded lesson would render unstyled.
    -->
    <link rel="stylesheet" href="../assets/lesson.css" />
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

/**
 * The shared stylesheet every lesson links (§5.1).
 *
 * **Responsive is the requirement, not a nicety.** §5.1 makes this file one of the
 * two enforcement points for it: fluid type, a measure in `ch`, and code blocks
 * and tables in their own `overflow-x: auto` container so a lesson never scrolls
 * the document sideways on a 375px screen.
 *
 * It also respects the reader's colour scheme. A lesson is framed inside an app
 * that has a dark theme, and a permanently white document inside it is the kind of
 * thing you only notice at night.
 */
export function stylesheet(): string {
  return `:root {
  color-scheme: light dark;
  --ink: #161d22;
  --paper: #fdfdfc;
  --muted: #5d6a72;
  --rule: #d8dee2;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e6ecef;
    --paper: #12171a;
    --muted: #9aa7ae;
    --rule: #2b3439;
  }
}

body {
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 2.5rem);
  /* A measure, not a pixel width: readable whatever type size the reader runs. */
  max-width: 68ch;
  background: var(--paper);
  color: var(--ink);
  font: clamp(15px, 0.95rem + 0.2vw, 18px) / 1.65 ui-sans-serif, system-ui, sans-serif;
}

h1 {
  margin: 0 0 0.25em;
  font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
  line-height: 1.2;
}

h2 {
  margin: 2em 0 0.5em;
  font-size: 1.25rem;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--rule);
}

p {
  margin: 0 0 1em;
}

.intent {
  color: var(--muted);
  margin-bottom: 2em;
}

/* Their own scroll container, so a wide one never moves the document sideways. */
pre,
.scroller {
  overflow-x: auto;
  padding: 0.9em 1em;
  background: color-mix(in oklab, var(--ink) 6%, transparent);
  border-radius: 6px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

img,
svg,
table {
  max-width: 100%;
}

button {
  font: inherit;
  /* 44px is the touch minimum §5.1 names; a quiz button below it is unusable. */
  min-height: 44px;
  padding: 0.5em 1em;
  color: var(--ink);
  background: color-mix(in oklab, var(--ink) 8%, transparent);
  border: 1px solid var(--rule);
  border-radius: 6px;
  cursor: pointer;
}

output {
  display: block;
  margin-top: 0.9em;
  min-height: 1.65em;
  color: var(--muted);
}
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
    <link rel="stylesheet" href="../assets/lesson.css" />
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
