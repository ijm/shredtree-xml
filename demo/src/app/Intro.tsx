// What a visitor sees first: what shredtree is, how to read the graph, and a way in. It
// covers the page while the store starts, so the wait is spent reading.

import { useEffect } from "react";

import hover from "../assets/intro/hover.webp";
import rebuild from "../assets/intro/rebuild.webp";
import { CLOSE, HOME, INFO, KEY, LOCK, RELOAD, TOOLS, TRASH, UNLOCK } from "./icons.ts";

export function Intro({ ready, onClose }: { ready: boolean; onClose: () => void }) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="intro" role="dialog" aria-modal="true" aria-labelledby="intro-title">
      <article>
        <button type="button" className="icon close" aria-label="close" onClick={onClose}>{CLOSE}</button>
        {/* only this part scrolls: the close button and the footer stay put */}
        <div className="scroll">
          <h1 id="intro-title">shredtree</h1>
          <p className="lead">An XML store for data pipelines, where derived data can't outlive what it was made from.</p>

          <section>
            <p>
              In a pipeline, most of what you store is derived: summaries, translations, extracts,
              each made from something else. When a source has to go, because of a deletion
              request, a revoked permission or a correction, everything made from it has to go too.
              That usually means cascade-delete code and a dependency index you hope is right.
            </p>
            <p>
              shredtree makes it structural. Each node is encrypted under a key derived from the node
              it sits in and from the current content of the nodes it was made from. Shred a source,
              change it, or lose the key that protects it, and everything made from it stops opening.
              Nothing downstream is deleted or rewritten, and there is no index to keep in sync: the
              derived data simply can't be read any more, and the pipeline rebuilds what it still can
              from what is there now.
            </p>
            <p>This demo runs the real store, in Python, in your browser.</p>
          </section>

          <section>
            <h2>Reading the graph</h2>
            <dl className="legend">
              <dt><span className="icon">{TRASH}</span></dt>
              <dd>Shred a node. It is gone, and so is everything made from it.</dd>
              <dt><span className="icon">{UNLOCK}</span><span className="icon">{LOCK}</span></dt>
              <dd>Apply a key to a paragraph, or take it off.</dd>
              <dt><span className="icon">{KEY}</span></dt>
              <dd>A node protected by that key, Alice's or Bob's.</dd>
              <dt><span className="icon tools">{TOOLS}</span></dt>
              <dd>A pipeline step whose result is missing. When it lights up, its sources are there:
                click to run its transform and build it.</dd>
              <dt><span className="tab-sample">name</span></dt>
              <dd>The step in the pipeline that made the node.</dd>
              <dt><span className="icon">{RELOAD}</span></dt>
              <dd>Load the scenario again, from the start.</dd>
              <dt><span className="icon">{HOME}</span></dt>
              <dd>Back to the starting view, after panning or zooming.</dd>
              <dt><span className="icon">{INFO}</span></dt>
              <dd>What the current scenario shows, and the way back to this page.</dd>
            </dl>
            <p>
              The <b>keyring</b> at the top holds the keys you have. Take one away and everything it
              protects, and everything made from that, disappears from view.
            </p>
            <p>
              <b>Moving around:</b> drag the background to pan, scroll or pinch to zoom, and
              double-click to zoom in.
            </p>
          </section>

          <section>
            <h2>Try it</h2>
            {/* the stills are taken at twice the pixels, the same per unit of graph, so shown at
                their own size their text is the same size; srcSet alone, as a src would count
                as a 1x choice and be shown at full pixel size */}
            <figure>
              <figcaption>
                Mouse over a control to see what it would affect. What glows orange stops opening if you
                click; what's lit is related; everything else fades.
              </figcaption>
              <img srcSet={`${hover} 2x`}
                   alt="An article's second paragraph with its lock hovered: its translation, the summary and the post glow orange." />
            </figure>
            <figure>
              <figcaption>
                In the manual scenarios nothing is built yet. Each orange button runs one step, once what it
                needs is there; then shred, re-key and rebuild, and watch what follows.
              </figcaption>
              <img srcSet={`${rebuild} 2x`}
                   alt="The manual Example Pipeline: two documents, and pipeline steps with orange build buttons." />
            </figure>
          </section>

        </div>
        <footer>
          <span className="status">{ready ? "the store is ready" : "starting the store…"}</span>
          <button type="button" className="enter on" onClick={onClose}>explore the demo</button>
        </footer>
      </article>
    </div>
  );
}
