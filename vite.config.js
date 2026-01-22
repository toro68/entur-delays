import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig(({ command }) => ({
  server: {
    port: 5200
  },
  build: {
    assetsDir: "assets",
    target: "es2015",
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
      },
    },
  },
  // GitHub Pages on GHES serves the project at the site root.
  // The Pages URL already includes the repository name, so we use "/" here.
  base: "/",
  plugins: [svelte()],
}));
