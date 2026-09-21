/**
 * The on-device perception path as the extension's offscreen page runs it
 * (OCR -> NER -> text-likelihood backstop -> scoped OCR rescue ->
 * assemblePerception), factored out so the fixture eval and the real-Chrome
 * harness (live-page.ts) exercise identical code. Callers must have called
 * initNer("cpu") once.
 */
import type { BBox, PiiCategory, Region, RedactionManifest } from "@sentrylens/shared";
import sharp from "sharp";
import { runOcr, runOcrScaled } from "../src/perception/ocr.js";
import { runNer } from "../src/perception/ner.js";
import { assemblePerception } from "../src/perception/pipeline.js";
import { textLikelihoodRegions, type RawImage } from "../src/perception/text-likelihood.js";
import { rescueBlindSpot } from "../src/perception/ocr-rescue.js";
import { iou, mergeRowBoxes } from "../src/redaction/geometry.js";
import type { MappingTable } from "../src/redaction/mapping.js";

export type RedactedManifestRegion = Extract<RedactionManifest["regions"][number], { kind: "redacted" }>;

export interface PerceptionInput {
  task: string;
  domRegions: Region[];
  domSensitive: { bbox: BBox; category: PiiCategory }[];
  /** device pixel ratio the screenshot was taken at (DOM boxes are CSS px) */
  dpr?: number;
  /** face boxes in IMAGE pixels, as MediaPipe reports them */
  faces?: BBox[];
  /** false disables the text-likelihood backstop and rescue (for before/after comparisons only) */
  backstop?: boolean;
}

export interface PerceptionRun {
  manifest: RedactionManifest;
  mapping: MappingTable;
  redacted: RedactedManifestRegion[];
  ocr: { words: { text: string; bbox: BBox }[]; joined: string };
  textLikelihoodBoxes: BBox[];
  /** blind-spot line boxes handed to the rescue pass (each costs up to 3 crop OCRs) */
  rescueAttempts: number;
  rescuedRegions: { bbox: BBox; category: PiiCategory; value: string }[];
  image: { w: number; h: number };
  /** wall-clock ms per phase (Node; the browser's wasm is slower) */
  timings: { ocr: number; ner: number; textLikelihood: number; rescue: number; assemble: number };
}

export async function runPerception(basePng: Buffer, input: PerceptionInput): Promise<PerceptionRun> {
  const pngDataUrl = `data:image/png;base64,${basePng.toString("base64")}`;

  const meta = await sharp(basePng).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const resample = async (_url: string, f: number) => {
    const up = await sharp(basePng).resize(Math.round(w * f), Math.round(h * f), { kernel: "lanczos3" }).png().toBuffer();
    return `data:image/png;base64,${up.toString("base64")}`;
  };
  const t0 = Date.now();
  const ocr = await runOcrScaled(pngDataUrl, { w, h }, resample);
  const tOcr = Date.now();
  const nerSpans = await runNer(ocr.joined);
  const tNer = Date.now();

  const { data, info } = await sharp(basePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const textLikelihoodBoxes = input.backstop === false ? [] : textLikelihoodRegions({ data, width: info.width, height: info.height, channels: info.channels });
  const tLike = Date.now();

  // Scoped second-pass rescue (see ocr-rescue.ts): only attempted on boxes
  // the whole-image OCR pass already completely missed (0 overlap), using
  // the SAME definition fuse.ts itself uses for "blind spot" — kept
  // identical deliberately so this never rescues a box fuse.ts wouldn't
  // otherwise fail-close, and never skips one it would.
  const blindSpots = textLikelihoodBoxes.filter((box) => !ocr.words.some((w) => iou(w.bbox, box) > 0));
  // Blind-spot boxes are frequently per-character/per-fragment (connected
  // components split low-contrast text at glyph gaps) rather than one
  // line box — merge same-row fragments first so the rescue crop has a
  // full line of context, not an isolated 1-3 character sliver (see
  // mergeRowBoxes's doc comment for the empirical evidence).
  const rescueBoxes = mergeRowBoxes(blindSpots);
  const rawImg = { data, width: info.width, height: info.height, channels: info.channels };
  const rescueIo = {
    encode: async (crop: RawImage) => {
      const cropPng = await sharp(Buffer.from(crop.data.buffer, crop.data.byteOffset, crop.data.byteLength), {
        raw: { width: crop.width, height: crop.height, channels: 4 },
      }).png().toBuffer();
      return `data:image/png;base64,${cropPng.toString("base64")}`;
    },
    ocr: runOcr,
  };
  const rescuedRegions: { bbox: BBox; category: PiiCategory; value: string }[] = [];
  for (const box of rescueBoxes) {
    const hit = await rescueBlindSpot(rawImg, box, rescueIo);
    if (hit) rescuedRegions.push(hit);
  }

  const tRescue = Date.now();
  const { manifest, mapping } = assemblePerception({
    task: input.task,
    image: { w: info.width, h: info.height, dpr: input.dpr ?? 1 },
    domRegions: input.domRegions,
    domSensitive: input.domSensitive,
    faces: input.faces ?? [],
    ocrWords: ocr.words,
    ocrJoined: ocr.joined,
    ocrOffsets: ocr.offsets,
    nerSpans,
    degraded: false,
    textLikelihoodBoxes,
    rescuedRegions,
  });

  const redacted = manifest.regions.filter((r) => r.kind === "redacted") as RedactedManifestRegion[];
  const timings = { ocr: tOcr - t0, ner: tNer - tOcr, textLikelihood: tLike - tNer, rescue: tRescue - tLike, assemble: Date.now() - tRescue };
  return { manifest, mapping, redacted, ocr, textLikelihoodBoxes, rescueAttempts: rescueBoxes.length, rescuedRegions, image: { w: info.width, h: info.height }, timings };
}
