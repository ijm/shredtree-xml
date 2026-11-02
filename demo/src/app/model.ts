// What the canvas shows: the scenario's derivations (which node was made from which),
// laid over whatever the store opens for the current keyring. The store only answers
// for the elements that open, so anything shredded, dead or locked simply isn't there.

import type { Engine } from "../engine/engine.ts";
import { BY_ID, Loaded, everyAcl } from "../engine/scenario.ts";
import type { Scenario, Step } from "../engine/scenario.ts";

/** A step as the demo reads it: the tests don't use `transform`, so the shared loader
 * doesn't declare it. */
type PipelineStep = Step & { transform?: string };

const NS = "https://ijm.github.io/shredtree-xml/shredtree.xsd";
const XMLNS = "http://www.w3.org/2000/xmlns/";

/** One element that opens. */
export interface Item {
  id: string;
  tag: string;
  attrs: [string, string][];
  text: string;
  parent: string | null;  // null: directly in the scenario
  kids: string[];
}

export interface View {
  items: Map<string, Item>;
  order: string[];  // document order, so every parent comes before its children
  edges: { source: string; target: string }[];
}

/** What the demo knows about a node beyond what the store shows. */
export interface Info {
  label?: string;
  transform?: string;  // what made this node from its sources
  acl?: string;        // the ACL the demo applied here
  inherited: boolean;  // an ancestor has an ACL applied
  derived: boolean;    // made from something, or inside something that was
}

export class Session {
  static #made = 0;
  /** Distinct per load, so the canvas starts afresh (and fits the view) for each. */
  readonly serial = Session.#made++;
  readonly loaded: Loaded;
  /** The ACLs to choose from; the privacy checkbox applies the first. */
  readonly acls: string[];
  readonly #labels = new Map<string, string>();
  readonly #transforms = new Map<string, string>();
  readonly #derived = new Map<string, string[]>();  // st:id -> the st:ids it was made from
  readonly #acl = new Map<string, string>();

  constructor(engine: Engine, scenario: Scenario) {
    this.loaded = new Loaded(engine, scenario);
    const named = everyAcl(scenario);
    this.acls = named.length ? named : ["Alice"];
    for (const step of scenario.steps as PipelineStep[]) {
      const id = this.loaded.ids.get(step.as)!;
      this.#labels.set(id, step.as);
      if (step.transform) this.#transforms.set(id, step.transform);
      if (step.from) this.#derived.set(id, step.from.map((r) => this.loaded.resolve(r)));
      if (step.acl) this.#acl.set(id, step.acl);
    }
  }

  view(keys: string[]): View {
    const found = this.loaded.engine.run(
      { op: "query", xpath: "/*/*", at: this.loaded.container }, keys) as string[];
    const items = new Map<string, Item>();
    const order: string[] = [];
    const walk = (el: Element, parent: string | null): string => {
      const id = el.getAttributeNS(NS, "id")!;
      const attrs = [...el.attributes]
        .filter((a) => a.namespaceURI !== NS && a.namespaceURI !== XMLNS)
        .map((a): [string, string] => [a.name, a.value]);
      const text = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent).join("").trim();
      const item: Item = { id, tag: el.tagName, attrs, text, parent, kids: [] };
      items.set(id, item);
      order.push(id);
      item.kids = [...el.children].map((c) => walk(c, id));
      return id;
    };
    const parser = new DOMParser();
    for (const xml of found) walk(parser.parseFromString(xml, "application/xml").documentElement, null);
    const edges = [...this.#derived].filter(([target]) => items.has(target))
      .flatMap(([target, refs]) => refs.filter((r) => items.has(r)).map((source) => ({ source, target })));
    return { items, order, edges };
  }

  info(view: View, id: string): Info {
    let inherited = false, derived = this.#derived.has(id);
    for (let p = view.items.get(id)!.parent; p !== null; p = view.items.get(p)!.parent) {
      inherited ||= this.#acl.has(p);
      derived ||= this.#derived.has(p);
    }
    return { label: this.#labels.get(id), transform: this.#transforms.get(id), acl: this.#acl.get(id),
             inherited, derived };
  }

  /** What would stop opening if `id` were shredded: its subtree, then everything made
   * from anything whose hash that changes, and so on. With `returns`, `id` is put back
   * straight away (a privacy change), so it isn't counted. */
  doomed(view: View, id: string, returns = false): Set<string> {
    const dead = new Set<string>(), changed = new Set<string>();
    const kill = (n: string) => {
      const todo = [n];
      for (let m = todo.pop(); m !== undefined; m = todo.pop()) {
        dead.add(m);
        changed.add(m);
        todo.push(...view.items.get(m)!.kids);
      }
      for (let p = view.items.get(n)!.parent; p !== null; p = view.items.get(p)!.parent) changed.add(p);
    };
    kill(id);
    for (let grew = true; grew;) {
      grew = false;
      for (const [n, refs] of this.#derived) {
        if (view.items.has(n) && !dead.has(n) && refs.some((r) => changed.has(r))) {
          kill(n);
          grew = true;
        }
      }
    }
    if (returns) dead.delete(id);
    return dead;
  }

  /** `id`'s lineage: what it was made from and what was made from it, each transitively,
   * with their subtrees; and the boxes that hold any of that, as context. A node's
   * content includes what's inside it and is part of what encloses it, so derivation
   * reaches through containment both ways. */
  lineage(view: View, id: string): { lit: Set<string>; context: Set<string> } {
    const subtree = (n: string): string[] => [n, ...view.items.get(n)!.kids.flatMap(subtree)];
    const ancestors = (n: string): string[] => {
      const out: string[] = [];
      for (let p = view.items.get(n)!.parent; p !== null; p = view.items.get(p)!.parent) out.push(p);
      return out;
    };
    const region = (n: string) => [...subtree(n), ...ancestors(n)];

    const down = new Set([id]), touched = new Set(region(id));
    for (let grew = true; grew;) {
      grew = false;
      for (const [n, refs] of this.#derived) {
        if (view.items.has(n) && !down.has(n) && refs.some((r) => touched.has(r))) {
          down.add(n);
          for (const m of region(n)) touched.add(m);
          grew = true;
        }
      }
    }
    const up = new Set<string>(), todo = [id];
    for (let n = todo.pop(); n !== undefined; n = todo.pop()) {
      for (const m of region(n)) {
        for (const r of this.#derived.get(m) ?? []) {
          if (view.items.has(r) && !up.has(r)) {
            up.add(r);
            todo.push(r);
          }
        }
      }
    }
    const lit = new Set([...down, ...up].flatMap(subtree));
    const context = new Set([...lit].flatMap(ancestors).filter((n) => !lit.has(n)));
    return { lit, context };
  }

  shred(id: string, keys: string[]): void {
    this.loaded.engine.run({ op: "shred", target: BY_ID, vars: { i: id } }, keys);
  }

  /** Content is sealed once, so changing a leaf's ACL means shredding it and inserting
   * it again, made from the same sources. It comes back last among its siblings. */
  setPrivate(view: View, id: string, priv: boolean, keys: string[]): void {
    const item = view.items.get(id)!;
    const doc = new DOMParser().parseFromString("<x/>", "application/xml");
    const el = doc.createElement(item.tag);
    for (const [k, v] of item.attrs) el.setAttribute(k, v);
    el.textContent = item.text;
    const acl = priv ? this.acls[0] : undefined;
    const refs = this.#derived.get(id) ?? [];
    const [, inserted] = this.loaded.engine.batch([
      { op: "shred", target: BY_ID, vars: { i: id } },
      { op: "insert", target: BY_ID, vars: { i: item.parent ?? this.loaded.container },
        xml: new XMLSerializer().serializeToString(el), refs, acl },
    ], acl ? [...new Set([...keys, acl])] : keys) as [number, { id: string }];
    for (const names of [this.#labels, this.#transforms]) {
      const name = names.get(id);
      if (name !== undefined) names.set(inserted.id, name);
    }
    if (refs.length) this.#derived.set(inserted.id, refs);
    if (acl) this.#acl.set(inserted.id, acl);
  }
}
