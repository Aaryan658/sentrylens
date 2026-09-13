import type { BBox, PiiCategory, Region } from "@sentrylens/shared";

export type DetectedBy = "dom" | "ocr+ner" | "regex" | "face" | "detector";

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
}
