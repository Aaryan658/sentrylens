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

// Same shared-load guard as ner.ts: warm-up and a task can both call initOcr.
let ocrLoading: Promise<void> | null = null;

export function initOcr(): Promise<void> {
  if (worker) return Promise.resolve();
  ocrLoading ??= loadOcr().finally(() => { ocrLoading = null; });
  return ocrLoading;
}

async function loadOcr(): Promise<void> {
  worker = await createWorker("eng", 1, tesseractOptions());
  // Screenshots have no real DPI metadata, so Tesseract estimates one from
  // stroke width — an estimate that skews low for small UI text (e.g. an
  // 8px field label) and can drop it below Tesseract's reliable-detection
  // threshold. A higher user_defined_dpi hint tells Tesseract to treat the
  // image as higher-resolution than its own estimate, improving recall on
  // small text at negligible cost on normal-size text.
  await worker.setParameters({ user_defined_dpi: "300" });
}

export async function disposeOcr(): Promise<void> {
  if (!worker) return;
  await worker.terminate();
  worker = null;
}

// Below this Tesseract word-confidence (0-100), a "hit" is more likely
// noise than real text than something worth feeding to NER/regex.
const MIN_WORD_CONFIDENCE = 35;

export interface OcrResult { words: OcrWord[]; joined: string; offsets: number[] }

// Tesseract misses small UI text at 1x: on the real demo page in Chrome it read
// neither the phone, email nor card values (~14px, light on dark), while a 2x
// resample read all but the card. A fixed 2x is deliberate: fractional factors
// are non-monotonic (1.25x and 1.5x lost the phone number, 1.75x and 2x got it),
// the same trap noted in ocr-rescue.ts. Screenshots above the pixel budget are
// left at 1x because 2x would quadruple OCR time; the blind-spot rescue and
// backstop still cover what the 1x pass misses there.
export const OCR_UPSCALE = 2;
export const OCR_UPSCALE_MAX_PIXELS = 1_500_000;

export function pickOcrScale(width: number, height: number): number {
  return width > 0 && height > 0 && width * height <= OCR_UPSCALE_MAX_PIXELS ? OCR_UPSCALE : 1;
}

/** Maps word boxes read from an upscaled image back to screenshot pixels. */
export function scaleOcrResult(r: OcrResult, factor: number): OcrResult {
  if (factor === 1) return r;
  return {
    ...r,
    words: r.words.map((w) => ({
      text: w.text,
      bbox: w.bbox.map((v) => v / factor) as [number, number, number, number],
    })),
  };
}

/**
 * OCR of a whole screenshot at the scale pickOcrScale chooses. `resample` is
 * environment-specific (canvas in the browser, sharp in Node) and must return a
 * PNG data URL of the image scaled by `factor`.
 */
export async function runOcrScaled(
  pngDataUrl: string,
  size: { w: number; h: number },
  resample: (dataUrl: string, factor: number) => Promise<string>,
): Promise<OcrResult> {
  const factor = pickOcrScale(size.w, size.h);
  if (factor === 1) return runOcr(pngDataUrl);
  return scaleOcrResult(await runOcr(await resample(pngDataUrl, factor)), factor);
}

export async function runOcr(pngDataUrl: string): Promise<OcrResult> {
  if (!worker) await initOcr();
  const { data } = await worker!.recognize(pngDataUrl);
  const words: OcrWord[] = [];
  const offsets: number[] = [];
  let joined = "";
  for (const w of (data.words ?? []) as Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>) {
    const text = w.text.trim();
    if (!text || w.confidence < MIN_WORD_CONFIDENCE) continue;
    if (joined.length) joined += " ";
    offsets.push(joined.length);
    joined += text;
    words.push({ text, bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1 - w.bbox.x0, w.bbox.y1 - w.bbox.y0] });
  }
  return { words, joined, offsets };
}
