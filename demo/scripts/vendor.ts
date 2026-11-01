// Fills public/vendor/pyodide/ with everything the demo loads at runtime: the Pyodide
// runtime, the Pyodide builds of cryptography and its dependencies, the elementpath
// wheel and a freshly built shredtree wheel. Nothing is fetched from a CDN at runtime.
//
//     node scripts/vendor.ts

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ELEMENTPATH = "5.1.4"; // pure Python and not in Pyodide's distribution
const PACKAGES = ["cryptography"]; // from Pyodide's distribution, with their dependencies
const CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

const demo = fileURLToPath(new URL("..", import.meta.url));
const pyodideDir = join(demo, "node_modules", "pyodide");
const out = join(demo, "public", "vendor", "pyodide");

interface LockPackage { file_name: string; sha256: string; depends: string[] }
interface PypiFile { filename: string; url: string; digests: { sha256: string } }

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function download(url: string, dest: string, digest: string): Promise<void> {
  if (existsSync(dest) && sha256(readFileSync(dest)) === digest) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (sha256(data) !== digest) throw new Error(`${url}: sha256 mismatch`);
  writeFileSync(dest, data);
}

function closure(lock: Record<string, LockPackage>, names: string[], seen = new Set<string>()): Set<string> {
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    closure(lock, lock[n].depends, seen);
  }
  return seen;
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true });
  const version: string = JSON.parse(readFileSync(join(pyodideDir, "package.json"), "utf8")).version;
  for (const f of CORE) copyFileSync(join(pyodideDir, f), join(out, f));

  const lock: Record<string, LockPackage> = JSON.parse(readFileSync(join(out, "pyodide-lock.json"), "utf8")).packages;
  for (const name of closure(lock, PACKAGES)) {
    const p = lock[name];
    await download(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${p.file_name}`, join(out, p.file_name), p.sha256);
  }

  const pypi = `https://pypi.org/pypi/elementpath/${ELEMENTPATH}/json`;
  const release = (await (await fetch(pypi)).json()) as { urls: PypiFile[] };
  const ep = release.urls.find((u) => u.filename.endsWith("-py3-none-any.whl"));
  if (ep === undefined) throw new Error(`${pypi}: no pure-Python wheel`);
  await download(ep.url, join(out, ep.filename), ep.digests.sha256);

  const build = mkdtempSync(join(tmpdir(), "shredtree-wheel-"));
  execFileSync("uv", ["build", "--wheel", "--quiet", "--out-dir", build, join(demo, "..", "python")], { stdio: "inherit" });
  const [wheel] = readdirSync(build).filter((f) => f.endsWith(".whl"));
  for (const old of readdirSync(out).filter((f) => f.startsWith("shredtree_xml-"))) rmSync(join(out, old));
  copyFileSync(join(build, wheel), join(out, wheel));
  rmSync(build, { recursive: true });

  const manifest = { pyodide: version, packages: PACKAGES, wheels: [ep.filename, wheel] };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`vendored Pyodide ${version}, ${[...closure(lock, PACKAGES)].join(", ")}, ${manifest.wheels.join(", ")}`);
}

await main();
