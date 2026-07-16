import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

function inspectApng(binary, relativePath) {
  assert.equal(binary.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${relativePath} must be PNG`);
  let width = null;
  let height = null;
  let frames = null;
  let plays = null;
  let frameControls = 0;

  for (let offset = 8; offset + 12 <= binary.length;) {
    const chunkLength = binary.readUInt32BE(offset);
    const type = binary.subarray(offset + 4, offset + 8).toString("ascii");
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkLength + 4;
    assert.ok(nextOffset <= binary.length, `${relativePath} contains a truncated ${type} chunk`);
    if (type === "IHDR") {
      width = binary.readUInt32BE(dataOffset);
      height = binary.readUInt32BE(dataOffset + 4);
    } else if (type === "acTL") {
      frames = binary.readUInt32BE(dataOffset);
      plays = binary.readUInt32BE(dataOffset + 4);
    } else if (type === "fcTL") {
      frameControls += 1;
    }
    offset = nextOffset;
  }

  assert.notEqual(frames, null, `${relativePath} must include an APNG acTL chunk`);
  return { width, height, frames, plays, frameControls };
}

const requiredFiles = [
  "index.html",
  "styles.css",
  "src/app.js",
  "src/game-data.js",
  "src/game-engine.js",
  "assets/pets.svg",
  "assets/arena.svg",
  "design/concept.svg",
  "pets/orange-fist/combat/manifest.json"
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
const combatManifest = JSON.parse(files["pets/orange-fist/combat/manifest.json"]);

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

assert.equal(combatManifest.format, "pawpact-combat-pack");
assert.equal(combatManifest.version, 1);
assert.equal(combatManifest.petId, "orange-fist");
assert.equal(combatManifest.unitId, "orange-cat");
assert.deepEqual(
  [combatManifest.sourceAtlas.columns, combatManifest.sourceAtlas.rows],
  [8, 4],
  "Orange Fist combat atlas must use an 8 x 4 grid"
);
const expectedCombatStates = ["attack-combo", "signature-skill", "hit-stagger", "victory"];
assert.deepEqual(Object.keys(combatManifest.states), expectedCombatStates);
assert.deepEqual(expectedCombatStates.map((state) => combatManifest.states[state].row), [0, 1, 2, 3]);

const combatRoot = join(root, "pets/orange-fist/combat");
assert.doesNotMatch(combatManifest.sourceAtlas.path, /\.\./, "combat atlas path must stay inside the pack");
const atlasBinary = await readFile(join(combatRoot, combatManifest.sourceAtlas.path));
assert.equal(atlasBinary.subarray(0, 4).toString("ascii"), "RIFF", "combat atlas must be WebP");
assert.equal(atlasBinary.subarray(8, 12).toString("ascii"), "WEBP", "combat atlas must be WebP");

for (const state of expectedCombatStates) {
  const relativePath = combatManifest.states[state].runtimePath;
  assert.doesNotMatch(relativePath, /\.\./, "combat animation paths must stay inside the pack");
  const binary = await readFile(join(combatRoot, relativePath));
  const animation = inspectApng(binary, relativePath);
  assert.deepEqual(
    [animation.width, animation.height],
    [combatManifest.runtimeFrame.width, combatManifest.runtimeFrame.height],
    `${relativePath} must match the runtime frame size`
  );
  assert.equal(animation.frames, combatManifest.states[state].frames, `${relativePath} APNG frame count must match its manifest`);
  assert.equal(animation.frameControls, animation.frames, `${relativePath} must define every APNG frame`);
  assert.equal(animation.plays, combatManifest.states[state].loop ? 0 : 1, `${relativePath} APNG loop count must match its manifest`);
}

console.log(`Static receipt: ${requiredFiles.length} required files, ${expectedSymbols.length} pet symbols, ${boardCells.length} concept cells, ${expectedCombatStates.length} combat animations.`);
console.log("Static receipt: no remote runtime assets or unsafe dynamic HTML/code patterns.");
