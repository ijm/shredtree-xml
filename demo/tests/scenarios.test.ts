// Every scenario in data/ and every one of its checks, run on shredtree under Pyodide:
// the same files python/tests/test_scenarios.py runs.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";

import { Engine } from "../src/engine/engine.ts";
import type { Manifest } from "../src/engine/engine.ts";
import { Loaded } from "../src/engine/scenario.ts";
import type { Check, Scenario } from "../src/engine/scenario.ts";

const vendor = fileURLToPath(new URL("../public/vendor/pyodide/", import.meta.url));
const data = new URL("../../data/", import.meta.url);
const files = readdirSync(data).filter((f) => f.endsWith(".json")).sort();
let engine: Engine;

before(async () => {
  const manifest: Manifest = JSON.parse(readFileSync(vendor + "manifest.json", "utf8"));
  const bridge = readFileSync(new URL("../src/engine/bridge.py", import.meta.url), "utf8");
  engine = await Engine.start(loadPyodide, vendor, manifest, bridge);
});

function run(scenario: Scenario, check: Check): void {
  const store = new Loaded(engine, scenario);
  const ids = (refs: string[] = []) => new Map(refs.map((r) => [r, store.resolve(r)]));
  const gone = ids(check.gone), kept = ids(check.kept), stale = ids(check.stale);
  const keys = check.keys ?? store.keys;
  if (check.shred !== undefined) store.shred(store.resolve(check.shred));
  else if (check.insert !== undefined)
    store.insert(store.resolve(check.insert.into), check.insert.xml, check.insert.acl);
  assert.deepEqual([...gone].filter(([, i]) => store.visible(i, keys)).map(([r]) => r), [], "should be gone");
  assert.deepEqual([...kept].filter(([, i]) => !store.visible(i, keys)).map(([r]) => r), [], "should be kept");
  if (check.stale !== undefined) assert.deepEqual(new Set(store.stale(keys)), new Set(stale.values()));
}

test("there are scenarios", () => assert.ok(files.length > 0));

for (const file of files) {
  const scenario: Scenario = JSON.parse(readFileSync(new URL(file, data), "utf8"));
  describe(file.replace(/\.json$/, ""), () => {
    test("loads with everything visible", () => {
      const store = new Loaded(engine, scenario);
      assert.ok([...store.ids.values()].every((i) => store.visible(i)));
      assert.deepEqual(store.stale(), []);
    });
    for (const check of scenario.checks) test(check.name, () => run(scenario, check));
  });
}
