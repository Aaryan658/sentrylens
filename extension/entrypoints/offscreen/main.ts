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

      let degraded = false;
      let ocr = { words: [] as { text: string; bbox: [number, number, number, number] }[], joined: "", offsets: [] as number[] };
      let nerSpans: { category: PiiCategory; value: string; start: number; end: number }[] = [];
      let faces: [number, number, number, number][] = [];
      let screenSummaryText = "";

      try {
        ocr = await runOcr(png);
        await initNer(device);
        nerSpans = await runNer(ocr.joined);
        const bmp = await createImageBitmap(await (await fetch(png)).blob());
        faces = await runFaces(bmp);
        await initDetector(device);
        await runDetector(png); // informational for MVP
      } catch (e) {
        degraded = true;
        console.warn("perception degraded:", e);
      }

      // SmolVLM screen summary is WebGPU-only and optional — skipped silently
      // (with a degraded notice already covering the rest) if it cannot load.
      try {
        if (device === "webgpu") { await initVlm(); screenSummaryText = await screenSummary(png); }
      } catch { /* VLM summary optional */ }

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
      });

      const redacted = manifest.regions.filter((r) => r.kind === "redacted");
      const sanitizedPng = await maskImage(png, redacted as never);
      sendResponse({ sanitizedPng, manifest, degraded, screenSummary: screenSummaryText });
    })();
    return true;
  }

  if (msg.type === Msg.RESOLVE_ACTION) {
    const action = msg.payload.action as AgentAction;
    if (action.type === "type") sendResponse({ action: { ...action, value: session.resolveAll(action.value) } });
    else sendResponse({ action });
    return true;
  }
  return false;
});
