// The canvas. Leaves are measured off-screen first (full text, so their heights vary),
// then elkjs places everything, then React Flow draws it. Hovering a node lights its
// lineage and fades the rest; hovering a control shows, in the alarm colour, what that
// action would take with it. None of that lays anything out again.

import { Background, BackgroundVariant, Handle, Position, ReactFlow } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Ref } from "react";

import { KEY, LOCK, TRASH, UNLOCK } from "./icons.ts";
import { layout } from "./layout.ts";
import { ancestors } from "./model.ts";
import type { Info, Item, Session, View } from "./model.ts";

interface Data extends Record<string, unknown> {
  item: Item;
  info: Info;
  depth?: number;  // boxes around this one: 0 at the top level
  nest?: number;   // levels of boxes inside this one: 0 for a leaf
}

type FlowNode = Node<Data, "leaf" | "box">;

/** What the pointer is showing. `focus` is the hovered node, if any. */
export interface Highlight {
  focus: string | null;
  lit: Set<string>;
  context: Set<string>;
  doomed: Set<string>;
}

export interface Actions {
  highlight: Highlight;
  lockKey: string;  // the key the lock button applies
  hover(id: string | null): void;
  preview(id: string | null, returns?: boolean): void;
  shred(id: string): void;
  setKeyed(id: string, keyed: boolean): void;
}

export const QUIET: Highlight = { focus: null, lit: new Set(), context: new Set(), doomed: new Set() };

const ActionsContext = createContext<Actions | null>(null);

function useActions(): Actions {
  return useContext(ActionsContext)!;
}

function Head({ item, info }: Data) {
  const act = useActions();
  const leaf = !item.kids.length;
  const keyed = info.acl !== undefined || info.inherited;
  return (
    <div className="head">
      <span className="what">
        {info.transform !== undefined && (
          // the rebuild control-to-be: disabled while the node's result is in the store
          <><button type="button" className="nodrag transform" disabled
                    title={`made by ${info.transform}`}>{info.transform}</button>→</>
        )}
        <span className="tag"><span className="angle">&lt;</span>{item.tag}<span className="angle">&gt;</span></span>
        {item.attrs.map(([k, v]) => <span key={k} className="attr">{k}={v}</span>)}
        {info.acl !== undefined && <span className="acl"><span className="icon">{KEY}</span>{info.acl}</span>}
      </span>
      <span className="controls">
        {leaf && (
          <button
            type="button" className="nodrag icon" disabled={info.inherited}
            title={info.inherited ? "keyed through an enclosing node"
              : info.acl !== undefined ? `${info.acl}'s key: remove it` : `no key: apply ${act.lockKey}'s key`}
            onMouseEnter={() => act.preview(item.id, true)} onMouseLeave={() => act.preview(null)}
            onClick={() => act.setKeyed(item.id, info.acl === undefined)}
          >{keyed ? LOCK : UNLOCK}</button>
        )}
        <button
          type="button" className="nodrag icon" title="shred"
          onMouseEnter={() => act.preview(item.id)} onMouseLeave={() => act.preview(null)}
          onClick={() => act.shred(item.id)}
        >{TRASH}</button>
      </span>
      <span className="id">{item.id.slice(0, 6)}</span>
    </div>
  );
}

/** A step's name, on a tab above the node's top-left corner: drawn as part of the node,
 * so it takes every state the border does. */
function Tab({ info }: Data) {
  return info.label === undefined ? null : <div className="tab">{info.label}</div>;
}

function state(id: string, h: Highlight): string | false {
  if (h.doomed.has(id)) return "doomed";
  if (h.lit.has(id)) return "lit";
  if (h.focus !== null && !h.context.has(id)) return "faded";
  return false;
}

function classes(data: Data, h: Highlight, kind: string): string {
  return ["st-node", kind, data.info.derived ? "is-derived" : "is-source",
          data.info.acl !== undefined && "keyed", state(data.item.id, h)]
    .filter(Boolean).join(" ");
}

function shape(data: Data): CSSProperties {
  return { "--depth": data.depth ?? 0, "--nest": data.nest ?? 0 } as CSSProperties;
}

function kind(item: Item): "leaf" | "box" {
  return item.kids.length ? "box" : "leaf";
}

/** What a node shows inside its border; a leaf's text, a box's children (placed by the
 * layout, not drawn here). Shared with Measure, so what is measured is what is drawn. */
function Contents(data: Data) {
  return (
    <>
      <Head {...data} />
      {kind(data.item) === "leaf" && data.item.text && <div className="body">{data.item.text}</div>}
    </>
  );
}

function GraphNode({ data }: NodeProps<FlowNode>) {
  const act = useActions();
  return (
    <div className={classes(data, act.highlight, kind(data.item))} style={shape(data)}
         onMouseEnter={() => act.hover(data.item.id)} onMouseLeave={() => act.hover(null)}>
      <Handle type="target" position={Position.Left} />
      <Tab {...data} />
      <Contents {...data} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { leaf: GraphNode, box: GraphNode };

/** How deep the boxes inside `id` go, which sets how green its border is. */
function nest(view: View, id: string): number {
  const { kids } = view.items.get(id)!;
  return kids.length ? 1 + Math.max(...kids.map((k) => nest(view, k))) : 0;
}

/** The leaves as they will be drawn, but off-screen and inert, so they can be measured. */
function Measure({ view, infos, into }: { view: View; infos: Map<string, Info>; into: Ref<HTMLDivElement> }) {
  return (
    <div className="measure" ref={into} aria-hidden>
      {view.order.filter((id) => kind(view.items.get(id)!) === "leaf").map((id) => {
        const data = { item: view.items.get(id)!, info: infos.get(id)! };
        return (
          <div key={id} data-id={id} className={classes(data, QUIET, "leaf")}>
            <Contents {...data} />
          </div>
        );
      })}
    </div>
  );
}

export function Graph({ view, session, actions }: { view: View; session: Session; actions: Actions }) {
  const measure = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<FlowNode[] | null>(null);
  const infos = useMemo(() => new Map(view.order.map((id) => [id, session.info(view, id)])), [view, session]);

  useLayoutEffect(() => {
    let live = true;
    void document.fonts.ready.then(async () => {
      const sizes = new Map<string, { width: number; height: number }>();
      for (const el of measure.current?.children ?? []) {
        const { id } = (el as HTMLElement).dataset;
        sizes.set(id!, { width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight });
      }
      const named = new Set(view.order.filter((id) => infos.get(id)!.label !== undefined));
      const boxes = await layout(view, sizes, named);
      if (!live) return;
      setNodes(view.order.map((id): FlowNode => {
        const item = view.items.get(id)!;
        const { x, y, width, height } = boxes.get(id)!;
        // leaves size themselves as they did when measured; a box takes elk's size
        return {
          id,
          type: kind(item),
          parentId: item.parent ?? undefined,
          position: { x, y },
          style: kind(item) === "box" ? { width, height } : undefined,
          data: { item, info: infos.get(id)!, depth: ancestors(view, id).length, nest: nest(view, id) },
        };
      }));
    });
    return () => { live = false; };
  }, [view, infos]);

  const h = actions.highlight;
  const edges = useMemo(() => view.edges.map((e): Edge => ({
    id: `${e.source}>${e.target}`,
    source: e.source,
    target: e.target,
    zIndex: 1000,  // above every box, so edges leaving nested nodes aren't cut by borders
    interactionWidth: 0,
    // A box enclosing the lineage is context, not lit, but an edge leaving it or
    // arriving at it carries the lineage's content all the same; it needs a lit end.
    className: (h.doomed.has(e.target) ? "doomed"
      : inLineage(e.source) && inLineage(e.target) && (h.lit.has(e.source) || h.lit.has(e.target)) ? "lit"
      : h.focus !== null ? "faded" : undefined),
  })), [view, h]);

  function inLineage(id: string): boolean {
    return h.lit.has(id) || h.context.has(id);
  }

  return (
    <ActionsContext value={actions}>
      <Measure view={view} infos={infos} into={measure} />
      {nodes && (
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="dark"
          fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.1}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        >
          <Background variant={BackgroundVariant.Lines} gap={48} lineWidth={0.5} />
        </ReactFlow>
      )}
    </ActionsContext>
  );
}
