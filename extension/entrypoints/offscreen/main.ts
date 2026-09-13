import "../../src/perception/env";
import { Msg } from "../../src/messaging";
import { runOcr } from "../../src/perception/ocr";
import { runNer, initNer } from "../../src/perception/ner";
import { runFaces } from "../../src/perception/faces";
import { runDetector, initDetector } from "../../src/perception/detector";
import { initVlm, screenSummary } from "../../src/perception/vlm";
import { assemblePerception } from "../../src/perception/pipeline";
import { maskImage } from "../../src/redaction/mask";
import { MappingTable } from "../../src/redaction/mapping";
import type { AgentAction, PiiCategory } from "@sentrylens/shared";

let session = new MappingTable();

async function hasWebGpu(): Promise<boolean> {
  try { return !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()); }
  catch { return false; }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.target !== "offscreen") return false;

  if (msg.type === Msg.RUN_PERCEPTION) {
    (async () => {
      const { png, regionList, domSensitive, task, newSession } = msg.payload;
      if (newSession) { session.clear(); session = new MappingTable(); }
      const device: "webgpu" | "wasm" = (await hasWebGpu()) ? "webgpu" : "wasm";
      console.log("[sentrylens] perception start, device =", device);

      let degraded = false;
      let ocr = { words: [] as { text: string; bbox: [number, number, number, number] }[], joined: "", offsets: [] as number[] };
      let nerSpans: { category: PiiCategory; value: string; start: number; end: number }[] = [];
      let faces: [number, number, number, number][] = [];
      let detections: { label: string; bbox: [number, number, number, number]; score: number }[] = [];
      let screenSummaryText = "";

      // Each model is independent — one failing (or *hanging*: a wasm worker that
      // never posts ready, an HF weight fetch that stalls) must not skip the
      // others. DOM-based redaction below works without any of them.
      const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
        Promise.race([
          p,
          new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
        ]);
      const tryStep = async (
        name: string,
        fn: () => Promise<void>,
        { ms = 25000, optional = false }: { ms?: number; optional?: boolean } = {},
      ) => {
        console.log(`[sentrylens] ${name}…`);
        try { await withTimeout(fn(), ms, name); console.log(`[sentrylens] ${name} ok`); }
        catch (e) { if (!optional) degraded = true; console.warn(`[sentrylens] ${name} failed:`, e); }
      };
      await tryStep("ocr", async () => { ocr = await runOcr(png); });
      await tryStep("ner", async () => { await initNer(device); nerSpans = await runNer(ocr.joined); });
      await tryStep("faces", async () => {
        const bmp = await createImageBitmap(await (await fetch(png)).blob());
        faces = await runFaces(bmp);
      }, { ms: 15000 });
      // yolos-tiny is a generic COCO detector, not a PII signal on its own —
      // supplementary, and its transformers.js API keeps shifting. Never let
      // it degrade the privacy result; its output only adds BYSTANDER_SCREEN
      // regions and a fallback FACE box (see fuse.ts), it never removes one.
      await tryStep("detector", async () => { await initDetector(device); detections = await runDetector(png); }, { optional: true });

      // SmolVLM screen summary is WebGPU-only and optional — skipped silently
      // (with a degraded notice already covering the rest) if it cannot load or
      // stalls loading its weights.
      try {
        if (device === "webgpu") {
          console.log("[sentrylens] vlm…");
          await withTimeout((async () => { await initVlm(); screenSummaryText = await screenSummary(png); })(), 30000, "vlm");
          console.log("[sentrylens] vlm ok");
        }
      } catch (e) { console.warn("[sentrylens] vlm failed:", e); }

      const { manifest } = assemblePerception({
        task,
        image: {
          w: regionList.viewport.w * regionList.viewport.dpr,
          h: regionList.viewport.h * regionList.viewport.dpr,
          dpr: regionList.viewport.dpr,
        },
        domRegions: regionList.regions,
        domSensitive: domSensitive.map((d: { bbox: [number, number, number, number]; category: string }) => ({ bbox: d.bbox, category: d.category as PiiCategory })),
        faces,
        ocrWords: ocr.words,
        ocrJoined: ocr.joined,
        ocrOffsets: ocr.offsets,
        nerSpans,
        degraded,
        mapping: session,
        detectorBoxes: detections,
      });

      const redacted = manifest.regions.filter((r) => r.kind === "redacted");
      const sanitizedPng = await maskImage(png, redacted as never);
      console.log(`[sentrylens] perception done: ${redacted.length} redacted region(s), degraded=${degraded}`);
      sendResponse({ sanitizedPng, manifest, degraded, screenSummary: screenSummaryText });
    })().catch((e) => {
      console.error("[sentrylens] perception fatal:", e);
      sendResponse({ error: `perception failed: ${String(e)}` });
    });
    return true;
  }

  if (msg.type === Msg.RESOLVE_ACTION) {
    try {
      const action = msg.payload?.action as AgentAction | undefined;
      if (!action || typeof action.type !== "string") {
        sendResponse({ action });
      } else if (action.type === "type") {
        sendResponse({ action: { ...action, value: session.resolveAll(action.value) } });
      } else {
        sendResponse({ action });
      }
    } catch (e) {
      console.error("[sentrylens] resolve failed:", e);
      sendResponse({ action: msg.payload?.action });
    }
    return true;
  }
  return false;
});
