import { createWorker, type Worker } from "tesseract.js";

let worker: Worker | null = null;

export interface OcrWord { text: string; bbox: [number, number, number, number] }

export async function initOcr(): Promise<void> {
  if (worker) return;
  worker = await createWorker("eng");
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
