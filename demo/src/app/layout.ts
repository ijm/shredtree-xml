// Positions. A box stacks its children in document order (elkjs reorders siblings to
// cut crossings, and a document's paragraphs must stay in order), and elkjs places only
// the top-level blocks, left to right. An edge to or from something nested is a port
// fixed at that node's height on its block, so elkjs still sees where edges really go.

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api.js";

import type { View } from "./model.ts";

export const HEADER = 28;  // a box's header, which its children sit below
const PAD = 8;

export interface Box { x: number; y: number; width: number; height: number }

const elk = new ELK();

/** Each element's box, relative to its parent's, given the leaves' measured sizes. */
export async function layout(view: View, leaves: Map<string, { width: number; height: number }>
): Promise<Map<string, Box>> {
  const out = new Map<string, Box>();
  const top = new Map<string, string>();       // element -> its top-level block
  const offset = new Map<string, number>();    // element -> y within its top-level block

  const stack = (id: string, x: number, y: number, block: string): Box => {
    const { kids } = view.items.get(id)!;
    let box: Box;
    if (!kids.length) {
      box = { x, y, ...leaves.get(id)! };
    } else {
      let width = 0, height = HEADER + PAD;
      for (const k of kids) {
        const b = stack(k, PAD, height, block);
        width = Math.max(width, b.width);
        height += b.height + PAD;
      }
      box = { x, y, width: width + 2 * PAD, height };
    }
    out.set(id, box);
    top.set(id, block);
    return box;
  };
  const blocks = view.order.filter((id) => view.items.get(id)!.parent === null);
  for (const id of blocks) stack(id, 0, 0, id);
  for (const id of view.order) {
    const { parent } = view.items.get(id)!;
    offset.set(id, parent === null ? 0 : offset.get(parent)! + out.get(id)!.y);
  }

  const ports = new Map<string, ElkPort[]>(blocks.map((b) => [b, []]));
  const port = (id: string, side: "in" | "out"): string => {
    const block = top.get(id)!;
    const pid = `${id}:${side}`;
    if (!ports.get(block)!.some((p) => p.id === pid)) {
      const b = out.get(id)!;
      ports.get(block)!.push({
        id: pid, width: 1, height: 1,
        x: side === "out" ? out.get(block)!.width : 0,
        y: offset.get(id)! + b.height / 2,
        layoutOptions: { "elk.port.side": side === "out" ? "EAST" : "WEST" },
      });
    }
    return pid;
  };
  const edges: ElkExtendedEdge[] = view.edges
    .filter((e) => top.get(e.source) !== top.get(e.target))
    .map((e, i) => ({ id: `e${i}`, sources: [port(e.source, "out")], targets: [port(e.target, "in")] }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "14",
    },
    children: blocks.map((id) => ({
      id, width: out.get(id)!.width, height: out.get(id)!.height, ports: ports.get(id),
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
    })),
    edges,
  };
  for (const n of (await elk.layout(graph)).children ?? []) {
    const b = out.get(n.id)!;
    out.set(n.id, { ...b, x: n.x ?? 0, y: n.y ?? 0 });
  }
  return out;
}
