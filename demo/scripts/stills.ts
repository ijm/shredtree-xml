// Takes the intro's stills from the running demo, so they always show the demo as it is.
// Drives headless Chrome over its DevTools protocol; run it against a served build:
//
//     npm run build && npx vite preview --port 4173 &
//     node scripts/stills.ts http://localhost:4173/
//
// CHROME may name the Chrome binary; the default is where macOS installs it.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.argv[2] ?? "http://localhost:4173/";
const chromePath = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = fileURLToPath(new URL("../src/assets/intro/", import.meta.url));
const port = 9400 + Math.floor(Math.random() * 500);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "shredtree-stills-"));
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--window-size=1600,900", "about:blank"], { stdio: "ignore" });

interface Target { type: string; webSocketDebuggerUrl: string }
let targets: Target[] = [];
for (let i = 0; i < 50 && !targets.length; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as Target[]; } catch { await sleep(200); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let next = 0;
const pending = new Map<number, (m: { result?: { result?: { value?: unknown }; data?: string } }) => void>();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(String(m.data));
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const send = (method: string, params: object = {}) =>
  new Promise<{ result?: { result?: { value?: unknown }; data?: string } }>((r) => {
    const id = ++next;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (expression: string) => {
  for (let i = 0; i < 240; i++) { if (await evaluate(expression)) return; await sleep(250); }
  throw new Error(`timed out waiting for ${expression}`);
};
const hover = async (element: string) => {
  const p = await evaluate(`(() => { const r = (${element}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
};
const pick = (title: string) => evaluate(`(() => { const s = document.querySelector("select");
  s.value = [...s.options].find((o) => o.text === ${JSON.stringify(title)}).value;
  s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
interface Clip { x: number; y: number; width: number; height: number; scale: number }

/** The nodes on show, with a margin, in CSS pixels, and the graph's zoom. */
const framing = async () => await evaluate(`(() => {
  const rs = [...document.querySelectorAll(".react-flow__node .st-node")].map((n) => n.getBoundingClientRect());
  const top = document.querySelector(".canvas").getBoundingClientRect().top;  // not into the banner
  const pad = 24, x = Math.min(...rs.map((r) => r.left)) - pad, y = Math.max(top, Math.min(...rs.map((r) => r.top)) - pad - 16);
  const zoom = Number(/scale\\(([^)]+)\\)/.exec(document.querySelector(".react-flow__viewport").style.transform)[1]);
  return { clip: { x, y, width: Math.max(...rs.map((r) => r.right)) + pad - x, height: Math.max(...rs.map((r) => r.bottom)) + pad - y, scale: 1 }, zoom };
})()`) as { clip: Clip; zoom: number };

const setDensity = (ratio: number) =>
  send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: ratio, mobile: false });

// The stills, each set up from a fresh choice of scenario.
const views: { name: string; setup: () => Promise<void> }[] = [
  {
    // what a hover shows: the alarm on everything a key change to this paragraph would take
    // (from the article: a short, wide graph, so it stays readable at the intro's width)
    name: "hover.webp",
    setup: async () => {
      await pick("One article, translated and summarised");
      await sleep(2500);
      await hover(`[...[...document.querySelectorAll(".react-flow__node .st-node")]
        .find((n) => n.querySelector(".body")?.textContent === "Her address appeared in the second paragraph.").querySelectorAll("button")].at(-2)`);
      await sleep(1200);
    },
  },
  {
    // a manual pipeline before anything is built: the steps waiting to be run
    name: "rebuild.webp",
    setup: async () => {
      await hover(`document.querySelector(".panel legend")`);
      await pick("Example Pipeline (manual)");
      await sleep(2500);
    },
  },
];

// The graph's zoom is read rather than assumed, as it is whatever the demo starts at.
// Every still is taken at the same pixels per unit of graph,
// chosen so the largest fits the intro's column (656 by 560 CSS pixels) shown at half
// its pixels: then shown at their own size, their text is all the same size.
const COLUMN = { width: 656, height: 560 };

try {
  mkdirSync(out, { recursive: true });
  await setDensity(1);
  await send("Page.navigate", { url });
  await until(`!!document.querySelector(".intro .enter")`);
  await evaluate(`document.querySelector(".intro .enter").click()`);
  await until(`document.querySelectorAll(".react-flow__node").length > 0`);

  const framed: { zoom: number; clip: Clip }[] = [];
  for (const v of views) { await v.setup(); framed.push(await framing()); }
  const perUnit = 2 * Math.min(...framed.map(({ clip, zoom }) =>
    Math.min(COLUMN.width / (clip.width / zoom), COLUMN.height / (clip.height / zoom))));

  for (const [i, v] of views.entries()) {
    await pick("Two independent threads");  // so the next choice is a change, and loads afresh
    await sleep(1500);
    await setDensity(perUnit / framed[i].zoom);
    await v.setup();
    const { clip } = await framing();
    const shot = await send("Page.captureScreenshot", { format: "webp", quality: 85, clip });
    writeFileSync(join(out, v.name), Buffer.from(shot.result!.data!, "base64"));
    console.log(`wrote ${v.name}: ${(perUnit / 2).toFixed(2)} CSS px per unit of graph`);
  }
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;  // Chrome writes to its profile as it shuts down
  rmSync(profile, { recursive: true, force: true });
}
