import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule } from "node:vm";

test("HTML browser module graph links without Node-only imports", async () => {
  const htmlUrl = new URL("../index.html", import.meta.url);
  const html = await readFile(htmlUrl, "utf8");
  const entries = [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>/g)].map(m => new URL(m[1], htmlUrl));
  assert.ok(entries.length, "HTML must expose a module entry");
  const modules = new Map();
  async function load(url) {
    if (!modules.has(url.href)) {
      const source = await readFile(url, "utf8");
      modules.set(url.href, new SourceTextModule(source, { identifier: url.href }));
    }
    return modules.get(url.href);
  }
  for (const entry of entries) {
    const mod = await load(entry);
    await mod.link(async (specifier, parent) => {
      assert.match(specifier, /^\.{1,2}\//, "browser graph must use relative imports: " + specifier);
      const url = new URL(specifier, parent.identifier);
      assert.equal(url.protocol, "file:");
      return load(url);
    });
  }
});
