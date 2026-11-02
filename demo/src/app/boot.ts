// The engine in the browser: Pyodide and the vendored wheels served from public/vendor,
// and the scenarios in ../data bundled in at build time.

import { loadPyodide } from "pyodide";

import bridge from "../engine/bridge.py?raw";
import { Engine } from "../engine/engine.ts";
import type { Manifest } from "../engine/engine.ts";
import type { Scenario } from "../engine/scenario.ts";

let starting: Promise<Engine> | undefined;

/** One engine per page, however often it is asked for (StrictMode runs effects twice). */
export function engine(): Promise<Engine> {
  starting ??= (async () => {
    const indexURL = new URL("vendor/pyodide/", document.baseURI).href;
    const manifest = (await (await fetch(indexURL + "manifest.json")).json()) as Manifest;
    return Engine.start(loadPyodide, indexURL, manifest, bridge);
  })();
  return starting;
}

const files = import.meta.glob<Scenario>("../../../data/*.json", { eager: true, import: "default" });

export const SCENARIOS: { name: string; scenario: Scenario }[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, scenario]) => ({ name: path.slice(path.lastIndexOf("/") + 1, -".json".length), scenario }));
