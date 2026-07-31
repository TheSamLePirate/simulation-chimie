/// <reference types="vitest/config" />
import { cpSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DOC_DIR = resolve(import.meta.dirname, "doc");

/**
 * Ship the standalone physics atlas (`doc/index.html`) alongside the app, at `<base>doc/`.
 *
 * It lives outside `public/` because it is authored documentation, not an app asset, and
 * `tracking.md` records that path. Doing the copy here rather than in the deploy workflow
 * means every build produces it, so `bun run preview` serves exactly what Pages will — and
 * the dev middleware keeps the in-app link working before anything is built.
 */
function publishDoc(): Plugin {
  return {
    name: "dynamique-chimie:publish-doc",

    configureServer(server) {
      // The atlas is one self-contained page (CDN styles, no local assets), so every
      // /doc path resolves to it. Revisit if it ever grows companion files.
      server.middlewares.use((req, res, next) => {
        const file = resolve(DOC_DIR, "index.html");
        if (!req.url?.startsWith("/doc") || !existsSync(file)) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(readFileSync(file));
      });
    },

    closeBundle() {
      if (!existsSync(DOC_DIR)) return;
      cpSync(DOC_DIR, resolve(import.meta.dirname, "dist/doc"), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), publishDoc()],
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
