import type { BBox, PiiCategory, Region } from "@sentrylens/shared";

export type DetectedBy = "dom" | "ocr+ner" | "regex" | "face" | "detector" | "heuristic";

export interface SensitiveRegion {
  bbox: BBox;
  category: PiiCategory;
  value: string | null;          // null for FACE
  confidence: number;            // 0..1
  detected_by: DetectedBy[];
}

export interface DetectorBox {
  label: string;
  bbox: BBox;
  score: number;
}

export interface PerceptionInputs {
  regions: Region[];             // from the DOM walk
  domSensitive: SensitiveRegion[];
  faces: BBox[];
  ocrWords: { text: string; bbox: BBox }[];
  nerSpans: { category: PiiCategory; value: string; start: number; end: number }[];
  ocrJoined: string;             // ocrWords joined by " " (offsets align to nerSpans)
  ocrOffsets: number[];          // start offset of each word in ocrJoined
  pageSensitive: boolean;
  detectorBoxes?: DetectorBox[]; // yolos-tiny COCO boxes, image px; optional, defaults to []
  // Candidate "something text-like is here" boxes from text-likelihood.ts's
  // local-variance heatmap — region proposals only, not confirmed PII; only
  // acted on in fuse.ts when they don't overlap any real OCR word (i.e.
  // Tesseract found nothing there at all).
  textLikelihoodBoxes?: BBox[];
  // Real category+value recovered from a scoped second-pass OCR retry on a
  // single text-likelihood blind spot (see ocr-rescue.ts). Only ever
  // enriches a heuristic region that fuse.ts is already going to redact —
  // never a signal fuse.ts trusts on its own, and never able to suppress
  // the fail-closed "heuristic" tag (see fuse.ts's merge logic).
  rescuedRegions?: { bbox: BBox; category: PiiCategory; value: string }[];
}
