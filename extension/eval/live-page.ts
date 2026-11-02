/**
 * Real-Chrome reproduction of the live extension path, headless, with a
 * pixel-level leak check.
 *
 * Launches Chrome over the DevTools protocol, opens demo/demo-dashboard.html at
 * a chosen viewport and device pixel ratio, signs in, then does what the
 * extension does: collects DOM regions with the REAL src/dom/walk.ts (bundled
 * with esbuild and injected), takes a real screenshot, and runs the same
 * OCR -> NER -> backstop -> rescue -> assemble path as the offscreen page
 * (eval/harness.ts). Prints every region with its source and paints the masked
 * image to eval/.live/ (git-ignored: the demo page loads a real local photo).
 *
 * --check finds each secret's exact on-screen box in the DOM, counts the glyph
 * ("ink") pixels inside it that the masks do NOT cover, and exits non-zero if
 * any secret is more than MAX_VISIBLE_INK visible. It is the measurement the
 * synthetic fixtures cannot give: they render clean text, so they never show an
 * OCR misread ("A111 1111111 1111") slipping past validation unmasked.
 *
 * Differences from the extension, stated plainly: OCR/NER run in Node, not the
 * browser's wasm/webgpu, and MediaPipe/yolos are not run (pass --face=x,y,w,h
 * to inject a face box in image px).
 *
 * Run from extension/:
 *   node --import tsx eval/live-page.ts [--page=dashboard|portal|all] [--dpr=1,1.25,1.5,2] [--w=760] [--h=800] [--check] [--face=x,y,w,h]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import type { BBox, PiiCategory, Region } from "@sentrylens/shared";
import { disposeOcr } from "../src/perception/ocr.js";
import { initNer, disposeNer } from "../src/perception/ner.js";
import { planMasks, MASK_COLOR } from "../src/redaction/mask.js";
import { runPerception } from "./harness.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const arg = (name: string, dflt: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? dflt;
const DPRS = arg("dpr", "1").split(",").map(Number);
const VW = Number(arg("w", "760"));
const VH = Number(arg("h", "800"));
const FACE = arg("face", "");
const CHECK = process.argv.includes("--check");
const PORT = 9333;

const PAGE_FILTER = arg("page", "all");

// What each demo page shows that must never reach the server in clear. `pixel`
// secrets are located by string in the DOM and must be masked in the image;
// `selectors` are boxes located by CSS selector; `manifestOnly` strings are not
// checked in pixels (a bare name in page text has no reliable detector) but must
// not appear anywhere in the manifest sent alongside the image.
interface Page { id: string; file: string; prep: string; pixel: string[]; selectors: string[]; manifestOnly: string[] }
const PAGES: Page[] = [
  {
    id: "dashboard", file: "demo/demo-dashboard.html", prep: `document.getElementById("login-btn").click(); 1`,
    pixel: ["A. Menon", "9000000000", "ops.lead@vssc.test", "ABCDE1234F", "4321 5678 9003", "4111 1111 1111 1111"],
    selectors: ["#username", "#password", ".avatar"], manifestOnly: [],
  },
  {
    // light theme, serif font, links and typed text: exercises DOM-name scrubbing
    id: "portal", file: "demo/demo-portal.html", prep: "1",
    pixel: ["john.doe@mail.com", "9000000000", "R. Iyer", "ABCDE1234F", "4321 5678 9003", "4111 1111 1111 1111"],
    selectors: [], manifestOnly: ["Priya Sharma"],
  },
];
/** A secret fails when more than this fraction of its glyph pixels remain visible. */
const MAX_VISIBLE_INK = 0.02;

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("no Chrome/Edge found; set CHROME_PATH");
  return found;
}

/** esbuild is a transitive dependency (pnpm hides it), so locate it in the store. */
function loadEsbuild(): { build: (opts: object) => Promise<{ outputFiles: { text: string }[] }> } {
  const store = join(ROOT, "node_modules", ".pnpm");
  const dir = readdirSync(store).find((d) => d.startsWith("esbuild@"));
  if (!dir) throw new Error("esbuild not found in node_modules/.pnpm");
  return createRequire(import.meta.url)(join(store, dir, "node_modules", "esbuild", "lib", "main.js"));
}

class Cdp {
  private id = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private waiters = new Map<string, Array<() => void>>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(`${m.error.message}`)) : p.res(m.result);
      } else if (m.method) {
        for (const w of this.waiters.get(m.method) ?? []) w();
        this.waiters.delete(m.method);
      }
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => { ws.addEventListener("open", () => res()); ws.addEventListener("error", () => rej(new Error("cdp connect failed"))); });
    return new Cdp(ws);
  }
  send<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method: string): Promise<void> {
    return new Promise((res) => { this.waiters.set(method, [...(this.waiters.get(method) ?? []), res]); });
  }
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page eval failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)}`);
    return r.result.value as T;
  }
  close() { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pageTarget(): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      const t = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
      if (t) return t.webSocketDebuggerUrl!;
    } catch { /* chrome still starting */ }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a page target");
}

/** Page-side: the CSS-px box of each secret. Text secrets via a DOM Range on the exact string. */
const locateJs = (textSecrets: string[], selSecrets: string[]) => `(() => {
  const out = [];
  const textSecrets = ${JSON.stringify(textSecrets)};
  const selSecrets = ${JSON.stringify(selSecrets)};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const s of textSecrets) {
      const i = n.textContent.indexOf(s);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + s.length);
      const b = r.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) out.push({ name: s, box: [b.left, b.top, b.width, b.height] });
    }
  }
  for (const sel of selSecrets) {
    const el = document.querySelector(sel); if (!el) continue;
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out.push({ name: sel, box: [b.left, b.top, b.width, b.height] });
  }
  return out;
})()`;

interface Capture {
  png: Buffer;
  dpr: number;
  regions: Region[];
  domSensitive: { bbox: BBox; category: PiiCategory }[];
  secrets: { name: string; box: BBox }[];
}

async function capture(cdp: Cdp, dpr: number, page: Page): Promise<Capture> {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: dpr, mobile: false });
  await sleep(300); // relayout at the new scale
  const collected = await cdp.eval<string>(`JSON.stringify({
    regionList: __sl.walkDom(location.href, { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }),
    domSensitive: __sl.domSensitiveRegions(), dpr: devicePixelRatio, secrets: ${locateJs(page.pixel, page.selectors)} })`);
  const c = JSON.parse(collected) as { regionList: { regions: Region[] }; domSensitive: Capture["domSensitive"]; dpr: number; secrets: Capture["secrets"] };
  const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
  return { png: Buffer.from(shot.data, "base64"), dpr: c.dpr, regions: c.regionList.regions, domSensitive: c.domSensitive, secrets: c.secrets };
}

/**
 * For each secret: fraction of its glyph ("ink") pixels NOT under any mask.
 * Ink = pixels differing from the box's dominant background luminance.
 */
async function visibleInk(cap: Capture, masks: BBox[], imgW: number, imgH: number) {
  const { data, info } = await sharp(cap.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = (x: number, y: number) => {
    const i = (y * info.width + x) * 3;
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  };
  const covered = (x: number, y: number) => masks.some((m) => x >= m[0] && x < m[0] + m[2] && y >= m[1] && y < m[1] + m[3]);
  return cap.secrets.map((s) => {
    const x0 = Math.max(0, Math.floor(s.box[0] * cap.dpr)), y0 = Math.max(0, Math.floor(s.box[1] * cap.dpr));
    const x1 = Math.min(imgW, Math.ceil((s.box[0] + s.box[2]) * cap.dpr)), y1 = Math.min(imgH, Math.ceil((s.box[1] + s.box[3]) * cap.dpr));
    if (x1 <= x0 || y1 <= y0) return { name: s.name, ink: 0, visible: 0, offscreen: true };
    const hist = new Map<number, number>();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = Math.round(lum(x, y) / 8); hist.set(q, (hist.get(q) ?? 0) + 1); }
    const bg = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]![0] * 8;
    let ink = 0, visible = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (Math.abs(lum(x, y) - bg) > 48) { ink++; if (!covered(x, y)) visible++; }
    }
    return { name: s.name, ink, visible, offscreen: false };
  });
}

async function main() {
  const esbuild = loadEsbuild();
  const bundle = await esbuild.build({
    entryPoints: [resolve(ROOT, "extension/src/dom/walk.ts")],
    bundle: true, format: "iife", globalName: "__sl", write: false, platform: "browser", target: "chrome110",
  });
  const walkJs = bundle.outputFiles[0]!.text;

  const profile = mkdtempSync(join(tmpdir(), "sentrylens-live-"));
  const chrome: ChildProcess = spawn(findChrome(), [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" });

  let failed = false;
  try {
    const cdp = await Cdp.connect(await pageTarget());
    await cdp.send("Page.enable");
    await initNer("cpu");
    const outDir = resolve(HERE, ".live");
    mkdirSync(outDir, { recursive: true });

    for (const page of PAGES.filter((p) => PAGE_FILTER === "all" || p.id === PAGE_FILTER)) {
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url: pathToFileURL(resolve(ROOT, page.file)).href });
    await loaded;
    await cdp.eval(walkJs);
    await cdp.eval(page.prep);
    await sleep(400); // layout + images
    console.log(`\n########## page: ${page.id}`);

    for (const dpr of DPRS) {
      const cap = await capture(cdp, dpr, page);
      const face = FACE ? (FACE.split(",").map(Number) as BBox) : null;
      const t0 = Date.now();
      const run = await runPerception(cap.png, {
        task: "open the telemetry report for station VSSC-03",
        domRegions: cap.regions, domSensitive: cap.domSensitive, dpr: cap.dpr, faces: face ? [face] : [],
      });
      const ms = Date.now() - t0;
      const ops = planMasks(run.redacted);
      console.log(`\n=== dpr ${cap.dpr}  image ${run.image.w}x${run.image.h}  perception ${ms}ms (${Object.entries(run.timings).map(([k, v]) => `${k} ${v}`).join(", ")})  OCR words=${run.ocr.words.length}  text-like boxes=${run.textLikelihoodBoxes.length}  rescue attempts=${run.rescueAttempts} recovered=${run.rescuedRegions.length}`);
      console.log(`${run.redacted.length} redacted region(s):`);
      for (const r of run.redacted) {
        const v = r.value_len != null ? run.mapping.resolve(r.placeholder) : null;
        console.log(`  ${r.category.padEnd(13)} ${r.detected_by.join("+").padEnd(18)} bbox=${r.bbox.map(Math.round).join(",").padEnd(20)} risk=${r.risk} value=${JSON.stringify(v)}`);
      }
      console.log(`OCR read: ${JSON.stringify(run.ocr.joined)}`);

      const tag = `${page.id}-dpr${cap.dpr}`;
      writeFileSync(join(outDir, `${tag}-raw.png`), cap.png);
      const layers = ops.map((op) => {
        const left = Math.max(0, Math.round(op.bbox[0]));
        const top = Math.max(0, Math.round(op.bbox[1]));
        const width = Math.max(1, Math.min(Math.round(op.bbox[2]), run.image.w - left));
        const height = Math.max(1, Math.min(Math.round(op.bbox[3]), run.image.h - top));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${MASK_COLOR}"/></svg>`;
        return { input: Buffer.from(svg), left, top };
      });
      writeFileSync(join(outDir, `${tag}-masked.png`), await sharp(cap.png).composite(layers).png().toBuffer());

      if (CHECK) {
        const results = await visibleInk(cap, ops.map((o) => o.bbox), run.image.w, run.image.h);
        for (const r of results) {
          if (r.offscreen) { console.log(`  [skip] ${r.name.padEnd(22)} not in viewport`); continue; }
          const frac = r.ink ? r.visible / r.ink : 0;
          const bad = frac > MAX_VISIBLE_INK;
          if (bad) failed = true;
          console.log(`  [${bad ? "LEAK" : " ok "}] ${r.name.padEnd(22)} ${r.visible}/${r.ink} glyph px visible (${(frac * 100).toFixed(1)}%)`);
        }
        // The manifest travels to the server as text next to the image: no secret
        // may appear anywhere in it (DOM element names are the usual culprit).
        const manifestJson = JSON.stringify(run.manifest);
        for (const s of [...page.pixel, ...page.manifestOnly]) {
          if (manifestJson.includes(s)) { failed = true; console.log(`  [LEAK] manifest text contains ${JSON.stringify(s)}`); }
        }
        console.log(`  manifest text: ${page.pixel.length + page.manifestOnly.length} secret string(s) checked`);
      }
    }
    }
    await Promise.allSettled([disposeOcr(), disposeNer()]);
    cdp.close();
  } finally {
    if (chrome.pid) spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  if (CHECK) console.log(failed ? "\nFAIL: a secret is visible in the masked image" : "\nPASS: no secret visible at any tested scale");
  setImmediate(() => process.exit(failed ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
