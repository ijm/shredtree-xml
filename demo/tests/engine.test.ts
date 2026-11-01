import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";

import { Engine, StoreError } from "../src/engine/engine.ts";
import type { Manifest } from "../src/engine/engine.ts";

const vendor = fileURLToPath(new URL("../public/vendor/pyodide/", import.meta.url));
let engine: Engine;

before(async () => {
  const manifest: Manifest = JSON.parse(readFileSync(vendor + "manifest.json", "utf8"));
  const bridge = readFileSync(new URL("../src/engine/bridge.py", import.meta.url), "utf8");
  engine = await Engine.start(loadPyodide, vendor, manifest, bridge);
});

beforeEach(() => engine.reset());

// the same check as python/tests/test_service.py::test_shred_counts_removed_nodes_and_cascades
test("shred counts removed nodes and cascades", () => {
  engine.run({ op: "insert", target: "/root", xml: "<doc><a><b>in b</b></a></doc>" });
  const b = engine.run({ op: "query", xpath: "string(//b/@st:id)" }) as string;
  engine.run({ op: "insert", target: "/root/doc", xml: "<derived/>", refs: [b] });
  assert.equal(engine.run({ op: "shred", target: "//a | //b" }), 1); // b went with a
  assert.equal(engine.run({ op: "query", xpath: "count(//derived)" }), 0);
  const stale = engine.run({ op: "stale", target: "/root/doc" }) as { tag: string }[];
  assert.deepEqual(stale.map((s) => s.tag), ["derived"]);
});

test("store errors come back as StoreError", () => {
  assert.throws(() => engine.run({ op: "insert", target: "//missing", xml: "<x/>" }),
                (e) => e instanceof StoreError && e.kind === "NotFound");
});
