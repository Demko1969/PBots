import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  }, {
    name: "offline-demo",
    apply: "build",
    async closeBundle() {
      let html = await readFile(join(output, "index.html"), "utf8");
      const script = html.match(/<script type="module" crossorigin src="(\.\/assets\/[^"]+)"><\/script>/);
      const style = html.match(/<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+)">/);
      if (!script || !style) throw new Error("The demo build must contain a script and stylesheet.");
      const [js, css] = await Promise.all([script, style].map(match => readFile(join(output, match[1]), "utf8")));
      html = html.replace(script[0], () => '<script type="module">' + js.replace(/<\/script/gi, "<\\/script") + "</script>");
      html = html.replace(style[0], () => "<style>" + css + "</style>");
      await writeFile(join(output, "Ortak-Akil-Demo.html"), html);
    },
  }],
  root: path("./"),
  base: "./",
  publicDir: false,
  oxc: { jsx: { runtime: "automatic" } },
  css: { postcss: { plugins: [tailwind({ base: path("../") })] } },
  build: { outDir: output, emptyOutDir: true },
});
