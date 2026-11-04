// shredtree running in Pyodide, driven through shredtree.rest: the same endpoints and
// JSON as the HTTP server, without HTTP. The caller supplies loadPyodide and the
// vendored files, so the same code runs in a browser worker and under Node's test runner.

import type { PyodideAPI, loadPyodide } from "pyodide";

type Vars = Record<string, unknown>;

export type Op =
  | { op: "insert"; target: string; xml: string; refs?: string[]; vars?: Vars; acl?: string }
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

/** A transform (python/tests/transform.py) refused its input; `kind` is the Python
 * exception's class name. */
export class TransformError extends Error {
  kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = "TransformError";
    this.kind = kind;
  }
}

interface Bridge {
  call(endpoint: string, acls: string, body: string): string;
  applyTransform(name: string, sources: string, args: string): string;
  reset(): void;
}

/** Where `modules` given to Engine.start are put, inside Pyodide's file system. */
const MODULES = "/shredtree-modules";

/** A shredtree.rest reply, or a transform's, which has the same shape. */
type Reply = { result: unknown } | { error: string; message: string };

export class Engine {
  #bridge: Bridge;

  private constructor(bridge: Bridge) {
    this.#bridge = bridge;
  }

  /** `indexURL` is the directory holding the vendored files, ending in "/" (a path
   * under Node). `modules` are extra Python modules, by name, as source text, importable
   * by the bridge: "transform" makes transform() work. */
  static async start(load: typeof loadPyodide, indexURL: string, manifest: Manifest,
                     bridgeSource: string, modules: Record<string, string> = {}): Promise<Engine> {
    const py: PyodideAPI = await load({ indexURL, packageCacheDir: indexURL });
    // loadPackage reports failures through errorCallback instead of rejecting, and
    // resolves a bare wheel name against the working directory under Node
    const errors: string[] = [];
    await py.loadPackage([...manifest.packages, ...manifest.wheels.map((w) => indexURL + w)],
                         { messageCallback: () => {}, errorCallback: (m) => errors.push(m) });
    if (errors.length) throw new Error(`loading Python packages failed:\n${errors.join("\n")}`);
    py.FS.mkdirTree(MODULES);
    for (const [name, source] of Object.entries(modules)) py.FS.writeFile(`${MODULES}/${name}.py`, source);
    py.runPython(`import sys; sys.path.insert(0, ${JSON.stringify(MODULES)})`);
    const ns = py.globals.get("dict")();
    py.runPython(bridgeSource, { globals: ns });
    return new Engine({ call: ns.get("call"), applyTransform: ns.get("apply_transform"), reset: ns.get("reset") });
  }

  /** Run `ops` as one transaction; a failure discards all of them and throws StoreError. */
  batch(ops: Op[], acls: string[] = []): unknown[] {
    const reply = JSON.parse(this.#bridge.call("/batch", acls.join(","), JSON.stringify({ ops }))) as Reply;
    if ("error" in reply) throw new StoreError(reply.error, reply.message);
    return reply.result as unknown[];
  }

  /** Run one op as its own transaction. */
  run(op: Op, acls: string[] = []): unknown {
    return this.batch([op], acls)[0];
  }

  /** The transform `name` applied to `sources`, serialized elements as queries return
   * them, with the step's `args`; the result is one serialized element, ready to insert. */
  transform(name: string, sources: string[], args: unknown[] = []): string {
    const reply = JSON.parse(this.#bridge.applyTransform(name, JSON.stringify(sources), JSON.stringify(args))) as Reply;
    if ("error" in reply) throw new TransformError(reply.error, reply.message);
    return reply.result as string;
  }

  /** Start again with an empty store. */
  reset(): void {
    this.#bridge.reset();
  }
}
