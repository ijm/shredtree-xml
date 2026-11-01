// Scenarios from data/ (see data/README.md), loaded through the engine the way a client
// would use the store: one insert per step, inside a top-level <scenario/> element.

import type { Engine } from "./engine.ts";

export interface Step {
  as: string;
  xml: string;
  into?: string;
  from?: string[];
}

export interface Check {
  name: string;
  shred?: string;
  insert?: { into: string; xml: string };
  gone?: string[];
  kept?: string[];
  stale?: string[];
}

export interface Scenario {
  title: string;
  about?: string;
  steps: Step[];
  checks: Check[];
}

export const BY_ID = "//*[@st:id = $i]";

/** A scenario inserted into the engine's store, which is emptied first, with its labels
 * mapped to st:ids. */
export class Loaded {
  readonly engine: Engine;
  readonly container: string;
  readonly ids = new Map<string, string>();

  constructor(engine: Engine, scenario: Scenario) {
    engine.reset();
    this.engine = engine;
    this.container = this.#insert("/root", "<scenario/>", []);
    for (const step of scenario.steps) {
      const into = step.into === undefined ? this.container : this.resolve(step.into);
      const refs = (step.from ?? []).map((r) => this.resolve(r));
      this.ids.set(step.as, this.#insert(BY_ID, step.xml, refs, { i: into }));
    }
  }

  /** The st:id a ref names: a label, or a label and an XPath relative to it. */
  resolve(ref: string): string {
    const slash = ref.indexOf("/");
    const label = slash < 0 ? ref : ref.slice(0, slash);
    const id = this.ids.get(label);
    if (id === undefined) throw new Error(`unknown label in ref ${ref}`);
    if (slash < 0) return id;
    const found = this.engine.run({ op: "query", xpath: `/*/${ref.slice(slash + 1)}/string(@st:id)`, at: id });
    if (!Array.isArray(found) || found.length !== 1) throw new Error(`${ref} selects ${JSON.stringify(found)}`);
    return found[0] as string;
  }

  /** Whether the node can be seen in queries now. */
  visible(id: string): boolean {
    return this.engine.run({ op: "query", xpath: `count(${BY_ID})`, vars: { i: id } }) === 1;
  }

  /** The st:ids the store lists as stale (outermost only). */
  stale(): string[] {
    const found = this.engine.run({ op: "stale", target: BY_ID, vars: { i: this.container } });
    return (found as { id: string }[]).map((s) => s.id);
  }

  /** Shred the node `id` names. */
  shred(id: string): void {
    this.engine.run({ op: "shred", target: BY_ID, vars: { i: id } });
  }

  /** Insert `xml` into the node `id` names. */
  insert(id: string, xml: string): string {
    return this.#insert(BY_ID, xml, [], { i: id });
  }

  #insert(target: string, xml: string, refs: string[], vars: Record<string, string> = {}): string {
    const result = this.engine.run({ op: "insert", target, xml, refs, vars });
    return (result as { id: string }).id;
  }
}
