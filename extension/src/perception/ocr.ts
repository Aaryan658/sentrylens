import { createWorker, type Worker } from "tesseract.js";

let worker: Worker | null = null;

export interface OcrWord { text: string; bbox: [number, number, number, number] }

// In an MV3 extension, tesseract.js must not fetch its worker/core/lang data
// from a CDN (blocked by CSP). Point it at the copies in extension/public/
// tesseract/. In Node (e2e harness) `chrome` is undefined -> use defaults.
function tesseractOptions(): Record<string, unknown> {
  if (typeof chrome === "undefined" || typeof chrome.runtime?.getURL !== "function") return {};
  const dir = chrome.runtime.getURL("tesseract/");
  return {
    workerPath: dir + "worker.min.js",
    corePath: dir,
    langPath: dir,
    workerBlobURL: false,
    cacheMethod: "none",
  };
}

export async function initOcr(): Promise<void> {
  if (worker) return;
  worker = await createWorker("eng", 1, tesseractOptions());
}

export async function disposeOcr(): Promise<void> {
  if (!worker) return;
  await worker.terminate();
  worker = null;
}

export async function runOcr(pngDataUrl: string): Promise<{ words: OcrWord[]; joined: string; offsets: number[] }> {
  if (!worker) await initOcr();
  const { data } = await worker!.recognize(pngDataUrl);
  const words: OcrWord[] = [];
  const offsets: number[] = [];
  let joined = "";
  for (const w of (data.words ?? []) as Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>) {
    const text = w.text.trim();
    if (!text) continue;
    if (joined.length) joined += " ";
    offsets.push(joined.length);
    joined += text;
    words.push({ text, bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0] });
  }
  return { words, joined, offsets };
}
