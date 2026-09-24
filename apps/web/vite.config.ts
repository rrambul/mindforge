import react from "@vitejs/plugin-react";
import { createReadStream } from "node:fs";
import { cp, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Excalidraw's fonts, served from this origin rather than a CDN (FR-X7).
 *
 * The whiteboard's canvas loads its handwriting fonts at runtime from
 * `window.EXCALIDRAW_ASSET_PATH`, falling back to esm.sh when that is unset or a
 * file is missing. Left alone, every learner who opened a system-design exercise
 * would make requests to a third party the product never chose — and a lesson
 * route that renders only while esm.sh is up.
 *
 * Served from `node_modules` rather than copied into `public/`: the fonts are 13 MB
 * of binaries that belong to the package version, not to this repository, and a
 * copy committed here would silently stop matching the day the package moved. Dev
 * serves them straight from the package; the build copies them into `dist/`.
 * `Whiteboard.tsx` sets the asset path to `EXCALIDRAW_ASSET_BASE`.
 */
const EXCALIDRAW_FONTS = fileURLToPath(
  new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts", import.meta.url),
);
const EXCALIDRAW_FONT_ROUTE = "/excalidraw/fonts";

function excalidrawAssets(): Plugin {
  return {
    name: "mindforge:excalidraw-assets",
    configureServer(server) {
      server.middlewares.use(EXCALIDRAW_FONT_ROUTE, (request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?")[0] ?? "");
        const file = resolve(EXCALIDRAW_FONTS, `.${path}`);
        // Nothing outside the package's font directory, whatever the URL says.
        if (!file.startsWith(EXCALIDRAW_FONTS + sep)) return next();
        stat(file).then(
          (info) => {
            if (!info.isFile()) return next();
            response.setHeader("Content-Type", "font/woff2");
            createReadStream(file).pipe(response);
          },
          () => next(),
        );
      });
    },
    async writeBundle(options) {
      if (options.dir === undefined) return;
      await cp(EXCALIDRAW_FONTS, join(options.dir, EXCALIDRAW_FONT_ROUTE), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawAssets()],
  /**
   * Pre-bundled at startup rather than discovered on first use. Both are behind
   * `React.lazy`, so Vite only meets them when a lesson with an exercise opens —
   * and when it re-optimizes it reloads every open page. That reload landing in
   * the middle of `e2e/exercise.spec.ts` was a 30-second timeout on the first run
   * after the canvas was installed, and a lost editor for anybody using the app.
   */
  optimizeDeps: {
    include: [
      "@excalidraw/excalidraw",
      "codemirror",
      "@codemirror/lang-javascript",
      "@codemirror/lang-python",
      "@codemirror/state",
      "@codemirror/view",
    ],
  },
  // One .env.local for the whole workspace, the same file the API reads. Vite
  // defaults to the app directory, which would mean maintaining the Supabase URL and
  // anon key in two places and discovering they disagree at runtime.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: {
    port: 5173,
    // Fail rather than drift. Vite's default is to increment to the next free port, and
    // the port is not a detail here: the API's CORS allow-list is exactly APP_ORIGIN, so
    // a silent move to 5174 turns every request into a preflight failure whose error
    // message never mentions the port. "Port 5173 is in use" is a diagnosis; a wall of
    // CORS errors is a puzzle.
    strictPort: true,
  },
});
