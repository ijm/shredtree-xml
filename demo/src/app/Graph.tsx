// The canvas. Leaves are measured off-screen first (full text, so their heights vary),
// then elkjs places everything, then React Flow draws it. Hovering a control haloes
// what that action would take with it, without laying anything out again.

import { Background, BackgroundVariant, Handle, Position, ReactFlow } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";

import { KEY, LOCK, TRASH, UNLOCK } from "./icons.ts";
import { layout } from "./layout.ts";
import type { Info, Item, Session, View } from "./model.ts";

interface Data extends Record<string, unknown> {
  item: Item;
  info: Info;
}

type FlowNode = Node<Data, "leaf" | "box">;

export interface Actions {
  halo: Set<string>;
  preview(id: string | null, returns?: boolean): void;
  shred(id: string): void;
  setPrivate(id: string, priv: boolean): void;
}

const ActionsContext = createContext<Actions | null>(null);

function useActions(): Actions {
  return useContext(ActionsContext)!;
}

function Head({ item, info }: Data) {
  const act = useActions();
  const leaf = !item.kids.length;
  const priv = info.acl !== undefined || info.inherited;
  return (
    <div className="head">
      <span className="what">
        {info.transform !== undefined && <span className="transform">{info.transform} →</span>}
        <span className="tag">{item.tag}</span>
        {info.label !== undefined && info.label !== item.tag && <span className="label">{info.label}</span>}
        {item.attrs.map(([k, v]) => <span key={k} className="attr">{k}={v}</span>)}
        {info.acl !== undefined && <span className="acl"><span className="icon">{KEY}</span>{info.acl}</span>}
      </span>
      <span className="id">{item.id.slice(0, 6)}</span>
      <span className="controls">
        {leaf && (
          <button
            type="button" className="nodrag icon" disabled={info.inherited}
            title={info.inherited ? "private through an enclosing node" : priv ? "private: make public" : "public: make private"}
            onMouseEnter={() => act.preview(item.id, true)} onMouseLeave={() => act.preview(null)}
            onClick={() => act.setPrivate(item.id, info.acl === undefined)}
          >{priv ? LOCK : UNLOCK}</button>
        )}
        <button
          type="button" className="nodrag icon" title="shred"
          onMouseEnter={() => act.preview(item.id)} onMouseLeave={() => act.preview(null)}
          onClick={() => act.shred(item.id)}
        >{TRASH}</button>
      </span>
    </div>
  );
}

function classes(data: Data, halo: Set<string>, kind: string): string {
  return ["st-node", kind, data.info.derived ? "is-derived" : "is-source",
          data.info.acl !== undefined && "private", halo.has(data.item.id) && "halo"]
    .filter(Boolean).join(" ");
}

function LeafNode({ data }: NodeProps<FlowNode>) {
  const { halo } = useActions();
  return (
    <div className={classes(data, halo, "leaf")}>
      <Handle type="target" position={Position.Left} />
      <Head {...data} />
      {data.item.text && <div className="body">{data.item.text}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function BoxNode({ data }: NodeProps<FlowNode>) {
  const { halo } = useActions();
  return (
    <div className={classes(data, halo, "box")}>
      <Handle type="target" position={Position.Left} />
      <Head {...data} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { leaf: LeafNode, box: BoxNode };

/** The leaves as they will be drawn, but off-screen, so they can be measured. */
function Measure({ view, session, into }: { view: View; session: Session; into: Ref<HTMLDivElement> }) {
  const idle: Actions = { halo: new Set(), preview() {}, shred() {}, setPrivate() {} };
  return (
    <ActionsContext value={idle}>
      <div className="measure" ref={into} aria-hidden>
        {view.order.filter((id) => !view.items.get(id)!.kids.length).map((id) => {
          const data = { item: view.items.get(id)!, info: session.info(view, id) };
          return (
            <div key={id} data-id={id} className={classes(data, idle.halo, "leaf")}>
              <Head {...data} />
              {data.item.text && <div className="body">{data.item.text}</div>}
            </div>
          );
        })}
      </div>
    </ActionsContext>
  );
}

export function Graph({ view, session, actions }: { view: View; session: Session; actions: Actions }) {
  const measure = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<FlowNode[] | null>(null);

  useLayoutEffect(() => {
    let live = true;
    void document.fonts.ready.then(async () => {
      const sizes = new Map<string, { width: number; height: number }>();
      for (const el of measure.current?.children ?? []) {
        const { id } = (el as HTMLElement).dataset;
        sizes.set(id!, { width: (el as HTMLElement).offsetWidth, height: (el as HTMLElement).offsetHeight });
      }
      const boxes = await layout(view, sizes);
      if (!live) return;
      setNodes(view.order.map((id): FlowNode => {
        const item = view.items.get(id)!;
        const { x, y, width, height } = boxes.get(id)!;
        // leaves size themselves as they did when measured; a box takes elk's size
        return {
          id,
          type: item.kids.length ? "box" : "leaf",
          parentId: item.parent ?? undefined,
          position: { x, y },
          style: item.kids.length ? { width, height } : undefined,
          data: { item, info: session.info(view, id) },
        };
      }));
    });
    return () => { live = false; };
  }, [view, session]);

  const edges = useMemo(() => view.edges.map((e): Edge => ({
    id: `${e.source}>${e.target}`,
    source: e.source,
    target: e.target,
    className: actions.halo.has(e.target) ? "halo" : undefined,
  })), [view, actions.halo]);

  return (
    <ActionsContext value={actions}>
      <Measure view={view} session={session} into={measure} />
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
