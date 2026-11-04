// The engine in the browser: Pyodide and the vendored wheels served from public/vendor,
// with the bridge and the transforms (shared with the Python tests) as source text, and
// the scenarios in ../data bundled in at build time.

import { loadPyodide } from "pyodide";

import transform from "../../../python/tests/transform.py?raw";
import bridge from "../engine/bridge.py?raw";
import { Engine } from "../engine/engine.ts";
import type { Manifest } from "../engine/engine.ts";
import { computed } from "../engine/scenario.ts";
import type { Scenario } from "../engine/scenario.ts";

let starting: Promise<Engine> | undefined;

/** One engine per page, however often it is asked for (StrictMode runs effects twice). */
export function engine(): Promise<Engine> {
  starting ??= (async () => {
    const indexURL = new URL("vendor/pyodide/", document.baseURI).href;
    const manifest = (await (await fetch(indexURL + "manifest.json")).json()) as Manifest;
    return Engine.start(loadPyodide, indexURL, manifest, bridge, { transform });
  })();
  return starting;
}

const files = import.meta.glob<Scenario>("../../../data/*.json", { eager: true, import: "default" });

export interface Entry {
  name: string;
  title: string;
  scenario: Scenario;
  byHand: boolean;  // computed steps are left for the user to build
  group: Group;
}

export type Group = "Demo scenarios" | "Test scenarios";

/** The scenarios shown as demos, in this order; every other one is a test. */
const DEMOS = ["example-pipeline", "acl"];

const byName = new Map(Object.entries(files).map(([path, scenario]) =>
  [path.slice(path.lastIndexOf("/") + 1, -".json".length), scenario]));

/** Demos first, in DEMOS order, then tests by file name. A scenario with computed steps
 * is offered twice: built on loading, and left to be built by hand, which must come to
 * the same thing. */
export const SCENARIOS: Entry[] = [
  ...DEMOS.map((name) => [name, byName.get(name)!] as const),
  ...[...byName].filter(([name]) => !DEMOS.includes(name)).sort(([a], [b]) => a.localeCompare(b)),
].flatMap(([name, scenario]) => {
  const group: Group = DEMOS.includes(name) ? "Demo scenarios" : "Test scenarios";
  if (!scenario.steps.some(computed)) return [{ name, title: scenario.title, scenario, byHand: false, group }];
  return [{ name, title: `${scenario.title} (autostart)`, scenario, byHand: false, group },
          { name: `${name}-manual`, title: `${scenario.title} (manual)`, scenario, byHand: true, group }];
});
