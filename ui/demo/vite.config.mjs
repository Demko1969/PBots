import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/postcss";

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

const output = path("../../output/web-demo");

export default defineConfig({
  resolve: { alias: [
    { find: "next/image", replacement: path("./image.tsx") },
    { find: "../lib/app-request", replacement: path("./transport.ts") },
  ] },
  plugins: [{
    name: "inline-demo-brand-assets",
    enforce: "pre",
    transform(css, id) {
      if (id !== path("../app/globals.css")) return;
      return css.replace(/url\("\/(ortak-akil-symbol(?:-filled)?\.png)"\)/g, (_, filename) =>
        'url("data:image/png;base64,' + readFileSync(path("../public/" + filename)).toString("base64") + '")');
    },
  }],
  root: path("./"),
  base: "./",
  publicDir: false,
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwind({ base: path("../") })] } },
  build: { outDir: output, emptyOutDir: true },
});
