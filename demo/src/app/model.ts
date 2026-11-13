// What the canvas shows: the scenario's derivations (which node was made from which),
// laid over whatever the store opens for the current keyring. The store only answers
// for the elements that open, so anything shredded, dead or locked simply isn't there.
// Every step whose node isn't there is shown as a placeholder, so the graph keeps its
// shape as things come and go: a computed step to be built on request once what it needs
// is there, a node the keyring can't open marked as invisible, and the rest as gone.

import type { Engine } from "../engine/engine.ts";
import { BY_ID, Loaded, computed, everyAcl } from "../engine/scenario.ts";
import type { Scenario, Step } from "../engine/scenario.ts";

const NS = "https://ijm.github.io/shredtree-xml/shredtree.xsd";
const XMLNS = "http://www.w3.org/2000/xmlns/";

/** Why a step's node isn't shown: `unbuilt`, a computed step not in the store (to be
 * built); `invisible`, in the store but not openable with these keys; `gone`, neither. */
export type Missing = "unbuilt" | "invisible" | "gone";

/** One element that opens, or the placeholder for a step whose node doesn't. */
export interface Item {
  id: string;
  tag: string;
  attrs: [string, string][];
  text: string;
  parent: string | null;  // null: directly in the scenario
  kids: string[];
  missing?: Missing;      // a placeholder: its id is MISSING and the step's name
}

export interface View {
  items: Map<string, Item>;
  order: string[];  // document order, so every parent comes before its children
  edges: { source: string; target: string }[];
  /** What the layout follows: the drawn edges and, between the steps' nodes or their
   * placeholders, the rest of the pipeline. Never drawn; they keep each step in its
   * column whatever is missing, shredded or invisible. */
  placing: { source: string; target: string }[];
  ready: Set<string>;  // placeholders whose step can be built now
}

const MISSING = "missing:";

/** The elements enclosing `id`, innermost first. */
export function ancestors(view: View, id: string): string[] {
  const out: string[] = [];
  for (let p = view.items.get(id)!.parent; p !== null; p = view.items.get(p)!.parent) out.push(p);
  return out;
}

/** `id` and everything inside it, in document order. */
export function subtree(view: View, id: string): string[] {
  return [id, ...view.items.get(id)!.kids.flatMap((k) => subtree(view, k))];
}

/** Everything whose content changes when `id`'s does: what is inside it, and what
 * encloses it. */
function region(view: View, id: string): string[] {
  return [...subtree(view, id), ...ancestors(view, id)];
}

/** What the demo knows about a node beyond what the store shows. */
export interface Info {
  label?: string;
  transform?: string;  // what made this node from its sources
  acl?: string;        // the ACL the demo applied here
  inherited: boolean;  // an ancestor has an ACL applied
  derived: boolean;    // made from something, or inside something that was
  ready: boolean;      // a placeholder whose step can be built now
}

export class Session {
  static #made = 0;
  /** Distinct per load, so the canvas starts afresh (and fits the view) for each. */
  readonly serial = Session.#made++;
  readonly loaded: Loaded;
  /** The keys to choose from: Alice's and Bob's in every scenario, and any other a
   * scenario names. */
  readonly acls: string[];
  /** The key the lock button applies. */
  readonly lockKey: string;
  readonly #steps: Step[];
  readonly #labels = new Map<string, string>();
  readonly #transforms = new Map<string, string>();
  readonly #derived = new Map<string, string[]>();  // st:id -> the st:ids it was made from
  readonly #acl = new Map<string, string>();

  /** With `byHand`, computed steps are not run on loading but wait to be built. */
  constructor(engine: Engine, scenario: Scenario, byHand = false) {
    this.loaded = new Loaded(engine, scenario, { transforms: !byHand });
    this.acls = [...new Set(["Alice", "Bob", ...everyAcl(scenario)])].sort();
    this.lockKey = "Alice";
    this.#steps = scenario.steps;
    for (const step of this.#steps) if (this.loaded.ids.has(step.as)) this.#register(step);
  }

  /** What the demo knows of the node the step's label names now. */
  #register(step: Step): void {
    const id = this.loaded.ids.get(step.as)!;
    this.#labels.set(id, step.as);
    if (step.transform) this.#transforms.set(id, step.transform);
    if (step.from) this.#derived.set(id, step.from.map((r) => this.loaded.resolve(r)));
    if (step.acl) this.#acl.set(id, step.acl);
  }

  /** Build the computed step `name` from what the store holds now, through `keys`. */
  build(name: string, keys: string[]): void {
    const step = this.#steps.find((s) => s.as === name)!;
    this.loaded.build(step, keys);
    this.#register(step);
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

    // every step's place in the pipeline, for its node or its placeholder
    const place = new Map<string, number>();
    this.#steps.forEach((s, i) => {
      place.set(MISSING + s.as, i);
      const id = this.loaded.ids.get(s.as);
      if (id !== undefined) place.set(id, i);
    });

    // what opens with every key, so a node missing from this view can be told apart as
    // one these keys can't open, rather than one that is gone; asked only if needed
    let everything: Set<string> | undefined;
    const opens = (id: string) => (everything ??= new Set(this.loaded.engine.run(
      { op: "query", xpath: "/*//*/string(@st:id)", at: this.loaded.container }, this.acls) as string[])).has(id);

    const ready = new Set<string>();
    const unbuilt = new Set<string>();
    for (const step of this.#steps) {
      const id = this.loaded.ids.get(step.as);
      if (id !== undefined && items.has(id)) continue;
      const missing: Missing = id !== undefined && opens(id) ? "invisible" : computed(step) ? "unbuilt" : "gone";
      // inside its parent, or its parent's placeholder; else there's nowhere to show it
      const into = step.into;
      const parent = into === undefined ? null
        : this.#find(into, items, keys) ?? (items.has(MISSING + into) ? MISSING + into : undefined);
      if (parent === undefined) continue;
      const pid = MISSING + step.as;
      items.set(pid, { id: pid, tag: "", attrs: [], text: "", parent, kids: [], missing });
      if (parent !== null) {
        // where the node was: before the first sibling from a later step
        const kids = items.get(parent)!.kids;
        const later = kids.findIndex((k) => (place.get(k) ?? -1) > place.get(pid)!);
        kids.splice(later < 0 ? kids.length : later, 0, pid);
      }
      order.push(pid);
      if (missing !== "unbuilt") continue;  // nothing to build, and no edges to draw
      unbuilt.add(pid);
      const sources = (step.from ?? []).map((r) => this.#find(r, items, keys));
      // a source still to be built is drawn as an edge from its placeholder, so the layout
      // knows where this step goes; but only real sources make it buildable
      (step.from ?? []).forEach((ref, k) => {
        const source = sources[k] ?? (unbuilt.has(MISSING + ref) ? MISSING + ref : undefined);
        if (source !== undefined) edges.push({ source, target: pid });
      });
      if (sources.every((x) => x !== undefined) && (parent === null || !items.get(parent)!.missing)
          && (step.acl === undefined || keys.includes(step.acl))) {
        ready.add(pid);
      }
    }

    // top-level nodes in step order, whatever order they were built in
    const tops = order.filter((id) => items.get(id)!.parent === null)
      .sort((a, b) => (place.get(a) ?? Infinity) - (place.get(b) ?? Infinity));
    const preorder = (id: string): string[] => [id, ...items.get(id)!.kids.flatMap(preorder)];
    // a step's node, or its placeholder
    const node = (label: string) => {
      const id = this.loaded.ids.get(label);
      return id !== undefined && items.has(id) ? id : items.has(MISSING + label) ? MISSING + label : undefined;
    };
    const placing = new Map(edges.map((e) => [`${e.source}>${e.target}`, e]));
    for (const step of this.#steps) {
      const target = node(step.as);
      if (target === undefined) continue;
      for (const ref of step.from ?? []) {
        // the node the ref names if it's there; else the node, or placeholder, it's in
        const owner = node(ref.split("/")[0]);
        const source = (owner !== undefined && !items.get(owner)!.missing ? this.#find(ref, items, keys) : undefined) ?? owner;
        if (source !== undefined) placing.set(`${source}>${target}`, { source, target });
      }
    }
    return { items, order: tops.flatMap(preorder), edges, placing: [...placing.values()], ready };
  }

  /** The st:id a ref names, if that node is in `items`: its label's node now, or the one
   * an XPath from it selects through `keys`. */
  #find(ref: string, items: Map<string, Item>, keys: string[]): string | undefined {
    const slash = ref.indexOf("/");
    const id = this.loaded.ids.get(slash < 0 ? ref : ref.slice(0, slash));
    if (id === undefined || !items.has(id)) return undefined;
    if (slash < 0) return id;
    const found = this.loaded.engine.run(
      { op: "query", xpath: `/*/${ref.slice(slash + 1)}/string(@st:id)`, at: id }, keys) as string[];
    return found.length === 1 && items.has(found[0]) ? found[0] : undefined;
  }

  info(view: View, id: string): Info {
    if (view.items.get(id)!.missing) {
      const step = this.#steps.find((s) => MISSING + s.as === id)!;
      return { label: step.as, transform: step.transform, acl: step.acl, inherited: false, derived: true,
               ready: view.ready.has(id) };
    }
    const up = ancestors(view, id);
    return { label: this.#labels.get(id), transform: this.#transforms.get(id), acl: this.#acl.get(id),
             inherited: up.some((p) => this.#acl.has(p)),
             derived: [id, ...up].some((n) => this.#derived.has(n)), ready: false };
  }

  /** `id`, and every visible node made, transitively, from it, from anything inside it,
   * or from anything enclosing it: a node's content is part of what encloses it, so a
   * change to it changes those too. */
  #downstream(view: View, id: string): Set<string> {
    const reached = new Set([id]), touched = new Set(region(view, id));
    for (let grew = true; grew;) {
      grew = false;
      for (const [n, refs] of this.#derived) {
        if (view.items.has(n) && !reached.has(n) && refs.some((r) => touched.has(r))) {
          reached.add(n);
          for (const m of region(view, n)) touched.add(m);
          grew = true;
        }
      }
    }
    return reached;
  }

  /** What would stop opening if `id` were shredded: its subtree, then everything made
   * from anything whose hash that changes, and so on. With `returns`, `id` is put back
   * straight away (a key change), so it isn't counted. */
  doomed(view: View, id: string, returns = false): Set<string> {
    const dead = new Set([...this.#downstream(view, id)].flatMap((n) => subtree(view, n)));
    if (returns) dead.delete(id);
    return dead;
  }

  /** `id`'s lineage: what it was made from and what was made from it, each transitively,
   * with their subtrees; and the boxes that hold any of that, as context. A node's
   * content includes what's inside it and is part of what encloses it, so derivation
   * reaches through containment both ways. */
  lineage(view: View, id: string): { lit: Set<string>; context: Set<string> } {
    const down = this.#downstream(view, id);
    const up = new Set<string>(), todo = [id];
    for (let n = todo.pop(); n !== undefined; n = todo.pop()) {
      for (const m of region(view, n)) {
        const refs = this.#derived.get(m) ?? view.edges.filter((e) => e.target === m).map((e) => e.source);
        for (const r of refs) {
          if (view.items.has(r) && !up.has(r)) {
            up.add(r);
            todo.push(r);
          }
        }
      }
    }
    const lit = new Set([...down, ...up].flatMap((n) => subtree(view, n)));
    const context = new Set([...lit].flatMap((n) => ancestors(view, n)).filter((n) => !lit.has(n)));
    return { lit, context };
  }

  shred(id: string, keys: string[]): void {
    this.loaded.engine.run({ op: "shred", target: BY_ID, vars: { i: id } }, keys);
  }

  /** Content is sealed once, so changing a leaf's ACL means shredding it and inserting
   * it again, made from the same sources. It comes back last among its siblings. */
  setKeyed(view: View, id: string, keyed: boolean, keys: string[]): void {
    const item = view.items.get(id)!;
    const doc = new DOMParser().parseFromString("<x/>", "application/xml");
    const el = doc.createElement(item.tag);
    for (const [k, v] of item.attrs) el.setAttribute(k, v);
    el.textContent = item.text;
    const acl = keyed ? this.lockKey : undefined;
    const refs = this.#derived.get(id) ?? [];
    const [, inserted] = this.loaded.engine.batch([
      { op: "shred", target: BY_ID, vars: { i: id } },
      { op: "insert", target: BY_ID, vars: { i: item.parent ?? this.loaded.container },
        xml: new XMLSerializer().serializeToString(el), refs, key: acl },
    ], acl ? [...new Set([...keys, acl])] : keys) as [number, { id: string }];
    for (const names of [this.#labels, this.#transforms]) {
      const name = names.get(id);
      if (name !== undefined) names.set(inserted.id, name);
    }
    // a step's own node, re-inserted: its label now names the new one
    const label = this.#labels.get(id);
    if (label !== undefined && this.loaded.ids.get(label) === id) this.loaded.ids.set(label, inserted.id);
    if (refs.length) this.#derived.set(inserted.id, refs);
    if (acl) this.#acl.set(inserted.id, acl);
  }
}
