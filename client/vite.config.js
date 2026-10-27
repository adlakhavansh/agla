import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// /api goes to the local API so the app and API share an origin, like the Vercel rewrite in production.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    proxy: { "/api": loadEnv(mode, process.cwd(), "").VITE_API_URL || "http://localhost:8080" },
  },
}));
