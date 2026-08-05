import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // One .env.local for the whole workspace, the same file the API reads. Vite
  // defaults to the app directory, which would mean maintaining the Supabase URL and
  // anon key in two places and discovering they disagree at runtime.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  server: { port: 5173 },
});
