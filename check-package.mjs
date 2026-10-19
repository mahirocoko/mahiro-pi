import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(manifest.name, "@mahirocoko/mahiro-pi");
assert.equal(manifest.version, "0.2.0");
assert.equal(manifest.private, true);
assert.equal(manifest.packageManager, "pnpm@10.33.0");
assert.equal(manifest.engines.node, ">=22.19.0");
assert.deepEqual(manifest.pi.extensions, ["./extensions/mahiro-status.ts", "./extensions/mahiro-finish-voice.ts", "./extensions/mahiro-continuity.ts", "./extensions/mahiro-agent-memory.ts"]);
assert.equal(manifest.devDependencies["@biomejs/biome"], "2.5.14");
assert.equal(manifest.letta, undefined);
assert.deepEqual(manifest.pi.skills, ["./skills"]);
for (const peer of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  assert.equal(manifest.peerDependencies[peer], ">=1.3.0");
  assert.equal(manifest.peerDependenciesMeta[peer].optional, true);
}
assert.equal((await readFile(resolve(root, ".npmrc"), "utf8")).trim(), "auto-install-peers=false");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compare-source", "Expected --compare-source <old-pi-root>");
const original = args.length ? resolve(args[1]) : undefined;
const roots = new Set(["extensions", "lib", "test", "docs", "agents", "skills"]);
const files = new Set(["package.json", "AGENTS.md", "README.md", "check-package.mjs", "check-geometry.ts", ".gitignore"]);
let compared = 0;
async function inspect(directory = "") {
  for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    if (!directory && !(item.isDirectory() ? roots.has(item.name) : files.has(item.name))) continue;
    if (item.name.startsWith(".") || /(?:auth|credential|secret|token|settings|mcp)(?:[.-]|$)/i.test(item.name)) continue;
    const name = directory ? `${directory}/${item.name}` : item.name;
    if (item.isDirectory()) { await inspect(name); continue; }
    if (!/\.(?:ts|mjs|json|md)$/.test(name) && ![".gitignore", ".npmrc"].includes(name)) continue;
    const bytes = await readFile(resolve(root, name));
    const source = bytes.toString("utf8");
    assert.ok(!/[\t ]+$/m.test(source), `${name}: trailing whitespace`);
    assert.ok(source.endsWith("\n"), `${name}: missing final newline`);
    if (/^(extensions|lib)\//.test(name)) {
      for (const match of source.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
        const specifier = match[1];
        assert.ok(specifier.startsWith("node:") || /^\.\.?\//.test(specifier)
          || ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].includes(specifier), `${name}: unexpected import ${specifier}`);
        if (specifier.startsWith(".")) assert.ok(resolve(root, name, "..", specifier).startsWith(root), `${name}: import escapes package`);
      }
    }
    if (original && /^(extensions|lib|test)\//.test(name)) {
      assert.deepEqual(bytes, await readFile(resolve(original, name)), `${name}: source drift`);
      compared++;
    }
  }
}
await inspect();
console.log(`Package/import/whitespace checks passed${original ? `; ${compared} copied files byte-identical` : ""}.`);
