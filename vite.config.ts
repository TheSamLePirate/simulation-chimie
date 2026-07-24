/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repo>/ — the deploy workflow sets
  // VITE_BASE accordingly; dev/preview/e2e keep the root base.
  base: process.env.VITE_BASE ?? "/",
  build: {
    // Three.js (webgpu + tsl) is the bulk of the bundle and is needed eagerly,
    // so code-splitting it wins little today. Revisit when scenes are lazy-loaded.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Heavy O(N²) physics/golden tests run in parallel files; give headroom under load.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/*.d.ts"],
    },
  },
});
