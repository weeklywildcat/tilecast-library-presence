import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const dest = new URL("build/", root);
for (const path of ["plugin/runtime/", "runtime/", "studio/"]) await mkdir(new URL(path, dest), { recursive: true });
await copyFile(new URL("tilecast.package.json", root), new URL("tilecast.package.json", dest));
await copyFile(new URL("plugin/tilecast.plugin.json", root), new URL("plugin/tilecast.plugin.json", dest));
await copyFile(new URL("guest/target/wasm32-unknown-unknown/release/library_presence.wasm", root), new URL("runtime/library_presence.wasm", dest));
await build({ entryPoints: [new URL("player/index.js", root).pathname], outfile: new URL("plugin/runtime/index.js", dest).pathname,
  bundle: true, format: "iife", minify: true, target: ["es2020"] });
const ui = await build({ entryPoints: [new URL("studio/index.js", root).pathname], bundle: true, format: "iife", write: false, minify: true, target: ["es2020"] });
const html = (await readFile(new URL("studio/page.html", root), "utf8"))
  .replace("__STYLE__", await readFile(new URL("studio/style.css", root), "utf8"))
  .replace("__SCRIPT__", ui.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
await writeFile(new URL("studio/index.html", dest), html);
console.log("Built self-contained Studio page, Player bundle, and Wasm package files.");
