// shredtree running in Pyodide, driven through shredtree.rest: the same endpoints and
// JSON as the HTTP server, without HTTP. The caller supplies loadPyodide and the
// vendored files, so the same code runs in a browser worker and under Node's test runner.

import type { PyodideAPI, loadPyodide } from "pyodide";

type Vars = Record<string, unknown>;

export type Op =
  | { op: "insert"; target: string; xml: string; refs?: string[]; vars?: Vars }
  | { op: "query"; xpath: string; vars?: Vars; at?: string }
  | { op: "shred"; target: string; vars?: Vars }
  | { op: "stale"; target: string; vars?: Vars };

/** public/vendor/pyodide/manifest.json, written by scripts/vendor.ts. */
export interface Manifest {
  pyodide: string;
  packages: string[];
  wheels: string[];
}

/** A ShredtreeError raised in Python; `kind` is its class name, e.g. "NotFound". */
export class StoreError extends Error {
  kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "StoreError";
    this.kind = kind;
  }
}

interface Bridge {
  call(endpoint: string, acl: string, body: string): string;
  reset(): void;
}

/** A shredtree.rest reply. */
type Reply = { result: unknown } | { error: string; message: string };

export class Engine {
  #bridge: Bridge;

  private constructor(bridge: Bridge) {
    this.#bridge = bridge;
  }

  /** `indexURL` is the directory holding the vendored files, ending in "/" (a path
   * under Node). */
  static async start(load: typeof loadPyodide, indexURL: string, manifest: Manifest,
                     bridgeSource: string): Promise<Engine> {
    const py: PyodideAPI = await load({ indexURL, packageCacheDir: indexURL });
    // loadPackage reports failures through errorCallback instead of rejecting, and
    // resolves a bare wheel name against the working directory under Node
    const errors: string[] = [];
    await py.loadPackage([...manifest.packages, ...manifest.wheels.map((w) => indexURL + w)],
                         { messageCallback: () => {}, errorCallback: (m) => errors.push(m) });
    if (errors.length) throw new Error(`loading Python packages failed:\n${errors.join("\n")}`);
    const ns = py.globals.get("dict")();
    py.runPython(bridgeSource, { globals: ns });
    return new Engine({ call: ns.get("call"), reset: ns.get("reset") });
  }

  /** Run `ops` as one transaction; a failure discards all of them and throws StoreError. */
  batch(ops: Op[], acl = ""): unknown[] {
    const reply = JSON.parse(this.#bridge.call("/batch", acl, JSON.stringify({ ops }))) as Reply;
    if ("error" in reply) throw new StoreError(reply.error, reply.message);
    return reply.result as unknown[];
  }

  /** Run one op as its own transaction. */
  run(op: Op, acl = ""): unknown {
    return this.batch([op], acl)[0];
  }

  /** Start again with an empty store. */
  reset(): void {
    this.#bridge.reset();
  }
}
