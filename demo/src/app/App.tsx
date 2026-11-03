import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useMemo, useReducer, useState } from "react";

import type { Engine } from "../engine/engine.ts";
import { SCENARIOS, engine as startEngine } from "./boot.ts";
import { Graph, QUIET } from "./Graph.tsx";
import type { Actions, Highlight } from "./Graph.tsx";
import { KEY } from "./icons.ts";
import { Session } from "./model.ts";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(() => Math.max(0, SCENARIOS.findIndex((s) => s.name === "article")));
  const [loads, reload] = useReducer((n: number) => n + 1, 0);
  const [session, setSession] = useState<Session | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [writes, wrote] = useReducer((n: number) => n + 1, 0);
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; returns: boolean } | null>(null);
  const [keyHover, setKeyHover] = useState<string | null>(null);

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
    setFocus(null);
    wrote();
  };

  const highlight = useMemo((): Highlight => {
    if (!view || !session) return QUIET;
    const shown = focus !== null && view.items.has(focus) ? focus : null;
    return {
      ...(shown === null ? QUIET : session.lineage(view, shown)),
      focus: shown,
      doomed: preview && view.items.has(preview.id)
        ? session.doomed(view, preview.id, preview.returns)
        : keyHover !== null && keys.includes(keyHover) ? vanishing(keyHover) : QUIET.doomed,
    };

    /** What would drop out of view without `key`: asked of the store, not worked out. */
    function vanishing(key: string): Set<string> {
      const without = session!.view(keys.filter((k) => k !== key)).items;
      return new Set([...view!.items.keys()].filter((id) => !without.has(id)));
    }
  }, [view, session, focus, preview, keyHover, keys]);
  const actions: Actions = {
    highlight,
    hover: setFocus,
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
        <fieldset className="group keyring">
          <legend>keyring</legend>
          {session?.acls.map((acl) => {
            const present = keys.includes(acl);
            return (
              <button
                type="button" key={acl} className={present ? "key present" : "key"} aria-pressed={present}
                title={present ? `key ${acl} is in the keyring: click to remove it` : `key ${acl} is not in the keyring: click to add it`}
                onMouseEnter={() => setKeyHover(acl)} onMouseLeave={() => setKeyHover(null)}
                onClick={() => setKeys(present ? keys.filter((k) => k !== acl) : [...keys, acl].sort())}
              ><span className="icon">{KEY}</span><span className="name">{acl}</span><span className="state">{present ? "present" : "absent"}</span></button>
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
