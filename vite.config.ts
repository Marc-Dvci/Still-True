import { resolve } from "node:path";
import { defineConfig } from "vite";

// The static site: five pages built into dist/web, served by Workers Static Assets.
export default defineConfig({
  root: "web",
  publicDir: "public",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "web/index.html"),
        board: resolve(import.meta.dirname, "web/board.html"),
        drill: resolve(import.meta.dirname, "web/drill.html"),
        privacy: resolve(import.meta.dirname, "web/privacy.html"),
        about: resolve(import.meta.dirname, "web/about.html"),
        "404": resolve(import.meta.dirname, "web/404.html"),
      },
    },
  },
});
