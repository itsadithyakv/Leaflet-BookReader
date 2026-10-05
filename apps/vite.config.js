import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// pdf.js fetches its CMaps (CJK text) and standard fonts by URL at runtime, so
// they cannot go through the bundler. Serving them straight from the installed
// pdfjs-dist keeps them in step with the library on every upgrade; the
// `pdfjs/<dir>/` paths are what readers/pageSources.ts asks for.
const pdfjsAssets = () => {
  const pdfjsRoot = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const dirs = ["cmaps", "standard_fonts"];

  return {
    name: "leaflet-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/pdfjs\/(cmaps|standard_fonts)\/([^/?#]+)/.exec(req.url ?? "");
        if (!match) return next();
        const file = path.join(pdfjsRoot, match[1], decodeURIComponent(match[2]));
        // The name comes from the URL, so refuse anything that escapes the folder.
        if (path.dirname(file) !== path.join(pdfjsRoot, match[1])) return next();
        try {
          const data = readFileSync(file);
          res.setHeader("Content-Type", "application/octet-stream");
          res.end(data);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        const source = path.join(pdfjsRoot, dir);
        for (const name of readdirSync(source)) {
          const file = path.join(source, name);
          if (!statSync(file).isFile()) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: readFileSync(file) });
        }
      }
    }
  };
};

// Pip's shop prices live in the art (src/pip/*.js), but Rust checks every
// purchase against its own copy and the server checks avatar parts against
// another. Regenerating both on every build and dev start (and whenever the
// art changes in dev) keeps them from drifting. A child process, so each run
// imports the art fresh; the script writes only when something changed.
const pipCatalogue = () => {
  const script = fileURLToPath(new URL("./scripts/pip-catalogue.mjs", import.meta.url));
  const run = () => {
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" }).trim();
    if (!out.endsWith("up to date")) {
      console.log(out);
    }
  };
  let timer = null;
  return {
    name: "leaflet-pip-catalogue",
    // A build must not ship prices Rust has not seen: a failure fails it.
    buildStart() {
      run();
    },
    handleHotUpdate({ file }) {
      // Vite hands over forward-slashed paths on every platform.
      if (!/\/src\/pip\/[^/]+\.js$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          run();
        } catch (error) {
          console.warn(`pip catalogue: ${error.message}`);
        }
      }, 300);
    }
  };
};

export default defineConfig({
  base: "./",
  plugins: [react(), pdfjsAssets(), pipCatalogue()],
  clearScreen: false,
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../packages/shared", import.meta.url))
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // WebView2 (and Android's System WebView) are evergreen Chromium, so there
    // is no old engine to transpile for; es2022 keeps class fields, top-level
    // await and `??=` native instead of down-levelled helpers.
    target: "es2022",
    // Maps would ship the whole source inside the package for no one to use.
    sourcemap: false,
    rollupOptions: {
      // Two pages: the app, and desktop Pip's own small window (Rust opens
      // it as `desktop-pip.html`; it loads the sprite and none of the app).
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "desktop-pip": fileURLToPath(new URL("./desktop-pip.html", import.meta.url))
      },
      output: {
        // The libraries every screen uses (React, state, icons, the list
        // virtualiser) in a chunk of their own, apart from the app's code.
        // epub.js and pdf.js stay with the readers, which load on demand.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler|zustand|lucide-react|@tanstack)[\\/]/.test(id)) {
            return "vendor";
          }
          return undefined;
        }
      }
    }
  },
  server: {
    strictPort: true,
    port: 1421
  }
});
