import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "fs";

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));
const projectPath = `/2026/${packageJson.name}`;

export default defineConfig(({ command }) => ({
  server: {
    port: 5200,
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
  // S3 hosting på editorial.aftenbladet.no/2026/sa-entur-delays/
  // Bruk relative stier i dev mode, full path i production build
  base: command === "build" ? projectPath : "/",
  plugins: [svelte()],
}));
