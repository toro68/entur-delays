import { defineConfig } from "vite";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const __dirname = dirname(fileURLToPath(import.meta.url));

const computeBase = (isDev) => {
  if (isDev) return "/";
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
  const year = new Date().getFullYear();
  return `https://editorial.aftenbladet.no/${year}/${pkg.name}/`;
};

export default defineConfig(({ command }) => ({
  server: {
    port: 5200
  },
  build: {
    assetsDir: "build",
    target: "es2015",
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
  base: computeBase(command === "serve"),
  plugins: [svelte()],
}));
