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
  base: command === "serve" ? "/" : "/entur-delays/",
  plugins: [svelte()],
}));
