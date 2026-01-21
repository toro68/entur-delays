import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  preprocess: vitePreprocess({
    scss: {
      api: "modern",
      prependData: `@use "${resolve(__dirname, "src/_entry.scss")}" as *;`,
    },
  }),
};
