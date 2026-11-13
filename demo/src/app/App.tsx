import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Engine } from "../engine/engine.ts";
import { SCENARIOS, engine as startEngine } from "./boot.ts";
import { Graph, QUIET } from "./Graph.tsx";
import type { Actions, Highlight, Tip } from "./Graph.tsx";
import { suggest } from "./guide.ts";
import type { Did, Suggestion } from "./guide.ts";
import { HOME, INFO, KEY, RELOAD } from "./icons.ts";
import { Intro } from "./Intro.tsx";
import { Session } from "./model.ts";

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);  // the first demo
  const [loads, reload] = useReducer((n: number) => n + 1, 0);
  const [session, setSession] = useState<Session | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [writes, wrote] = useReducer((n: number) => n + 1, 0);
  const [homes, goHome] = useReducer((n: number) => n + 1, 0);  // asks for the starting view
  const [focus, setFocus] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; returns: boolean } | null>(null);
  const [keyHover, setKeyHover] = useState<string | null>(null);
  // the intro covers the page on every load; the app appears behind it only once it has
  // been dismissed, so its buttons flash where they can be seen
  const [intro, setIntro] = useState(true);
  const [entered, setEntered] = useState(false);
  const closeIntro = useCallback(() => { setIntro(false); setEntered(true); }, []);
  // suggestions: each shown once per loading of the demo, its tip gone once it has flashed
  const shown = useRef(new Set<Suggestion>());
  const tips = useRef(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const offer = (did?: Did) => {
    const s = suggest(SCENARIOS[pick].name, did, shown.current);
    setTip(s === undefined ? null : { at: s.at, control: s.control, text: s.text, serial: ++tips.current });
  };

  useEffect(() => {
    startEngine().then(setEngine, (e: unknown) => setError(`engine failed to start: ${e}`));
  }, []);

  useEffect(() => {
    if (engine === null) return;
    try {
      const s = new Session(engine, SCENARIOS[pick].scenario, SCENARIOS[pick].byHand);
      setSession(s);
      setKeys(s.acls);
      setError(null);
      offer();
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

  /** `f` on the node `id`, then whatever that suggests next. */
  const did = (what: Did["do"], id: string, f: () => void) => {
    const at = session!.info(view!, id).label;  // asked first: `f` may take the node away
    act(f);
    if (at === undefined) setTip(null);
    else offer({ do: what, at });
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
    tip,
    tipDone: (serial) => setTip((t) => (t?.serial === serial ? null : t)),
    lockKey: session?.lockKey ?? "",
    hover: setFocus,
    preview: (id, returns = false) => setPreview(id === null ? null : { id, returns }),
    shred: (id) => did("shred", id, () => session!.shred(id, keys)),
    setKeyed: (id, keyed) => did("lock", id, () => session!.setKeyed(view!, id, keyed, keys)),
    build: (name) => { act(() => session!.build(name, keys)); offer({ do: "build", at: name }); },
  };

  const { scenario } = SCENARIOS[pick];
  return (
    <>
    {entered && <div className="app">
      <header className="panel">
        <fieldset className="group">
          <legend>shredtree scenario</legend>
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
            {[...new Set(SCENARIOS.map((s) => s.group))].map((group) => (
              <optgroup key={group} label={group}>
                {SCENARIOS.map((s, i) => s.group === group && <option key={s.name} value={i}>{s.title}</option>)}
              </optgroup>
            ))}
          </select>
          <button type="button" className="icon" title="load the scenario again" onClick={reload}>{RELOAD}</button>
          <button type="button" className="icon" title="back to the starting view" onClick={goHome}>{HOME}</button>
          {scenario.about && (
            <span className="about">
              <button type="button" className="icon" aria-label="about this scenario" aria-describedby="about">{INFO}</button>
              {/* keyed by session, so each scenario flashes its description as it appears */}
              <span className="tooltip" role="tooltip" id="about" key={session?.serial ?? "starting"}>
                <span>
                  {scenario.about}
                  <button type="button" className="link" onClick={() => setIntro(true)}>what's shredtree?</button>
                </span>
              </span>
            </span>
          )}
        </fieldset>
        <fieldset className="group keyring">
          <legend>keyring</legend>
          {session?.acls.map((acl) => {
            const present = keys.includes(acl);
            return (
              <button
                type="button" key={acl} className={present ? "key on" : "key off"} aria-pressed={present}
                title={present ? `key ${acl} is in the keyring: click to remove it` : `key ${acl} is not in the keyring: click to add it`}
                onMouseEnter={() => setKeyHover(acl)} onMouseLeave={() => setKeyHover(null)}
                onClick={() => { setKeys(present ? keys.filter((k) => k !== acl) : [...keys, acl].sort()); offer({ do: "key", at: acl }); }}
              ><span className="icon">{KEY}</span><span className="name">{acl}</span><span className="state">{present ? "present" : "absent"}</span></button>
            );
          })}
        </fieldset>
      </header>
      {error !== null && <div className="error">{error}</div>}
      <main className="canvas">
        {view && session
          ? <ReactFlowProvider key={session.serial}><Graph view={view} session={session} actions={actions} home={homes} /></ReactFlowProvider>
          : <div className="boot">{engine ? "loading scenario…" : "starting the store (Pyodide)…"}</div>}
      </main>
    </div>}
    {intro && <Intro ready={engine !== null} onClose={closeIntro} />}
    </>
  );
}
