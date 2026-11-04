// Scenarios from data/ (see data/README.md), loaded through the engine the way a client
// would use the store: one insert per step, inside a top-level <scenario/> element. A
// step without xml is made by its transform from its sources, as the store returns them.

import type { Engine } from "./engine.ts";

export interface Step {
  as: string;
  xml?: string;
  transform?: string;
  args?: unknown[];
  into?: string;
  from?: string[];
  acl?: string;
}

export interface Check {
  name: string;
  shred?: string;
  insert?: { into: string; xml: string; acl?: string };
  keys?: string[];
  gone?: string[];
  kept?: string[];
  stale?: string[];
  text?: Record<string, string>;
}

export interface Scenario {
  title: string;
  about?: string;
  steps: Step[];
  checks: Check[];
}

export const BY_ID = "//*[@st:id = $i]";

/** Every ACL the scenario names, in steps, inserts or keyrings. */
export function everyAcl(scenario: Scenario): string[] {
  const named = new Set<string>();
  for (const step of scenario.steps) if (step.acl) named.add(step.acl);
  for (const check of scenario.checks) {
    for (const k of check.keys ?? []) named.add(k);
    if (check.insert?.acl) named.add(check.insert.acl);
  }
  return [...named].sort();
}

/** Whether a step is made by its transform, rather than given as xml. Only these can be
 * built again: a given node, once shredded, is gone. */
export function computed(step: Step): boolean {
  return step.xml === undefined;
}

/** A scenario inserted into the engine's store, which is emptied first, with its labels
 * mapped to st:ids. With `transforms` false, computed steps are left for build(). */
export class Loaded {
  readonly engine: Engine;
  readonly keys: string[];
  readonly container: string;
  readonly ids = new Map<string, string>();

  constructor(engine: Engine, scenario: Scenario, { transforms = true } = {}) {
    engine.reset();
    this.engine = engine;
    this.keys = everyAcl(scenario);
    this.container = this.#insert("/root", "<scenario/>", []);
    for (const step of scenario.steps) if (transforms || !computed(step)) this.build(step);
  }

  /** Insert the step, its refs resolved now, through the keyring `keys`; its label then
   * names the new node. */
  build(step: Step, keys: string[] = this.keys): string {
    const into = step.into === undefined ? this.container : this.resolve(step.into, keys);
    const refs = (step.from ?? []).map((r) => this.resolve(r, keys));
    const xml = step.xml ?? this.made(step.transform!, refs, keys, step.args);
    const id = this.#insert(BY_ID, xml, refs, { i: into }, step.acl, keys);
    this.ids.set(step.as, id);
    return id;
  }

  /** The st:id a ref names: a label, or a label and an XPath relative to it. */
  resolve(ref: string, keys: string[] = this.keys): string {
    const slash = ref.indexOf("/");
    const label = slash < 0 ? ref : ref.slice(0, slash);
    const id = this.ids.get(label);
    if (id === undefined) throw new Error(`unknown label in ref ${ref}`);
    if (slash < 0) return id;
    const xpath = `/*/${ref.slice(slash + 1)}/string(@st:id)`;
    const found = this.engine.run({ op: "query", xpath, at: id }, keys);
    if (!Array.isArray(found) || found.length !== 1) throw new Error(`${ref} selects ${JSON.stringify(found)}`);
    return found[0] as string;
  }

  /** What the transform `name` makes from the nodes `refs`, each as a query returns it,
   * and `args`. */
  made(name: string, refs: string[], keys: string[] = this.keys, args: unknown[] = []): string {
    const sources = refs.map((r) => {
      const [found] = this.engine.run({ op: "query", xpath: BY_ID, vars: { i: r } }, keys) as string[];
      return found;
    });
    return this.engine.transform(name, sources, args);
  }

  /** The node's text nodes, in document order, joined by |. */
  text(id: string, keys: string[] = this.keys): string {
    return this.engine.run({ op: "query", xpath: `string-join(${BY_ID}//text(), '|')`, vars: { i: id } }, keys) as string;
  }

  /** Whether the node can be seen in queries now, through the keyring `keys`. */
  visible(id: string, keys: string[] = this.keys): boolean {
    return this.engine.run({ op: "query", xpath: `count(${BY_ID})`, vars: { i: id } }, keys) === 1;
  }

  /** The st:ids the store lists as stale (outermost only), through the keyring `keys`. */
  stale(keys: string[] = this.keys): string[] {
    const found = this.engine.run({ op: "stale", target: BY_ID, vars: { i: this.container } }, keys);
    return (found as { id: string }[]).map((s) => s.id);
  }

  /** Shred the node `id` names. */
  shred(id: string): void {
    this.engine.run({ op: "shred", target: BY_ID, vars: { i: id } }, this.keys);
  }

  /** Insert `xml` into the node `id` names, with `acl` applied to it. */
  insert(id: string, xml: string, acl?: string): string {
    return this.#insert(BY_ID, xml, [], { i: id }, acl);
  }

  #insert(target: string, xml: string, refs: string[], vars: Record<string, string> = {},
          acl?: string, keys: string[] = this.keys): string {
    const result = this.engine.run({ op: "insert", target, xml, refs, vars, acl }, keys);
    return (result as { id: string }).id;
  }
}
