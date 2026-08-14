import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // ws: true so the /api/runs/:id/stream upgrade is proxied to the API too.
      "/api": { target: "http://localhost:3001", ws: true },
    },
  },
});
