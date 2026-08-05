import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
