import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useReducer, useState } from "react";

import type { Engine } from "../engine/engine.ts";
import { SCENARIOS, engine as startEngine } from "./boot.ts";
import { Graph } from "./Graph.tsx";
import { KEY } from "./icons.ts";
import type { Actions } from "./Graph.tsx";
import { Session } from "./model.ts";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(() => Math.max(0, SCENARIOS.findIndex((s) => s.name === "article")));
  const [loads, reload] = useReducer((n: number) => n + 1, 0);
  const [session, setSession] = useState<Session | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [writes, wrote] = useReducer((n: number) => n + 1, 0);
  const [preview, setPreview] = useState<{ id: string; returns: boolean } | null>(null);

  useEffect(() => {
    startEngine().then(setEngine, (e: unknown) => setError(`engine failed to start: ${e}`));
  }, []);

  useEffect(() => {
    if (engine === null) return;
    try {
      const s = new Session(engine, SCENARIOS[pick].scenario);
      setSession(s);
      setKeys(s.acls);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [engine, pick, loads]);

  // writes: the store changed underneath the session, so it has to be read again
  const view = useMemo(() => session?.view(keys), [session, keys, writes]);

  const act = (f: () => void) => {
    try {
      f();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    setPreview(null);
    wrote();
  };

  const halo = useMemo(() => view && session && preview && view.items.has(preview.id)
    ? session.doomed(view, preview.id, preview.returns) : new Set<string>(), [view, preview, session]);
  const actions: Actions = {
    halo,
    preview: (id, returns = false) => setPreview(id === null ? null : { id, returns }),
    shred: (id) => act(() => session!.shred(id, keys)),
    setPrivate: (id, priv) => act(() => session!.setPrivate(view!, id, priv, keys)),
  };

  const { scenario } = SCENARIOS[pick];
  return (
    <div className="app">
      <header className="panel">
        <span className="brand">shredtree</span>
        <fieldset className="group">
          <legend>scenario</legend>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {SCENARIOS.map((s, i) => <option key={s.name} value={i}>{s.scenario.title}</option>)}
          </select>
          <button type="button" className="icon" title="load the scenario again" onClick={reload}>↺</button>
        </fieldset>
        <fieldset className="group">
          <legend>keyring</legend>
          {session?.acls.map((acl) => {
            const held = keys.includes(acl);
            return (
              <button
                type="button" key={acl} className={held ? "key held" : "key"} aria-pressed={held}
                title={held ? `holding ${acl}: click to drop it` : `not holding ${acl}: click to add it`}
                onClick={() => setKeys(held ? keys.filter((k) => k !== acl) : [...keys, acl].sort())}
              ><span className="icon">{KEY}</span>{acl}<span className="state">{held ? "held" : "not held"}</span></button>
            );
          })}
        </fieldset>
        {scenario.about && (
          <fieldset className="group about">
            <legend>about</legend>
            <p>{scenario.about}</p>
          </fieldset>
        )}
      </header>
      {error !== null && <div className="error">{error}</div>}
      <main className="canvas">
        {view && session
          ? <ReactFlowProvider key={session.serial}><Graph view={view} session={session} actions={actions} /></ReactFlowProvider>
          : <div className="boot">{engine ? "loading scenario…" : "starting the store (Pyodide)…"}</div>}
      </main>
    </div>
  );
}
