import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const requiredFiles = [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/game-data.js",
  "src/game-engine.js",
  "assets/pets.svg",
  "assets/arena.svg",
  "design/concept.svg"
];

const files = Object.fromEntries(
  await Promise.all(requiredFiles.map(async (relativePath) => {
    const source = await readFile(join(root, relativePath), "utf8");
    assert.ok(source.length > 100, `${relativePath} must not be empty`);
    return [relativePath, source];
  }))
);

const html = files["index.html"];
const css = files["styles.css"];
const app = files["src/app.js"];
const pets = files["assets/pets.svg"];
const arena = files["assets/arena.svg"];
const concept = files["design/concept.svg"];

for (const pattern of [
  /<html lang="zh-Hant">/,
  /name="viewport"/,
  /class="skip-link"/,
  /role="status" aria-live="polite"/,
  /<dialog id="result-dialog"/,
  /id="battle-board"[\s\S]*tabindex="-1"/
]) {
  assert.match(html, pattern, `index.html is missing ${pattern}`);
}

for (const pattern of [/:focus-visible/, /prefers-reduced-motion: reduce/, /forced-colors: active/]) {
  assert.match(css, pattern, `styles.css is missing ${pattern}`);
}

for (const forbidden of [/\.innerHTML\b/, /insertAdjacentHTML/, /\beval\s*\(/, /new Function\b/, /document\.write\b/]) {
  assert.doesNotMatch(app, forbidden, `src/app.js contains forbidden dynamic HTML/code: ${forbidden}`);
}

for (const source of [html, css, app.replace("http://www.w3.org/2000/svg", "")]) {
  assert.doesNotMatch(source, /https?:\/\//, "shipped page code must not depend on remote resources");
}

const expectedSymbols = [
  "orange-cat",
  "siamese-cat",
  "british-cat",
  "ragdoll-cat",
  "shiba-dog",
  "corgi-dog",
  "husky-dog",
  "golden-dog"
];

for (const symbolId of expectedSymbols) {
  const matches = pets.match(new RegExp(`<symbol id="${symbolId}"`, "g")) || [];
  assert.equal(matches.length, 1, `pets.svg must define ${symbolId} exactly once`);
}

for (const svg of [pets, arena, concept]) {
  assert.doesNotMatch(svg, /(?:href|xlink:href)="https?:\/\//, "SVG assets must not reference remote files");
}

const boardCells = concept.match(/<use href="#(?:enemy|home)-cell"/g) || [];
assert.equal(boardCells.length, 30, "visual concept must show a 5 x 6 board");

console.log(`Static receipt: ${requiredFiles.length} required files, ${expectedSymbols.length} pet symbols, ${boardCells.length} concept cells.`);
console.log("Static receipt: no remote runtime assets or unsafe dynamic HTML/code patterns.");
