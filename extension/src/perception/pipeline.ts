import type { Region, RedactionManifest, PiiCategory } from "@sentrylens/shared";
import { fuseRegions } from "../redaction/fuse.js";
import { classify, type ClassifiedRegion } from "../redaction/classify.js";
import { buildManifest, type ElementInput } from "../redaction/manifest.js";
import { MappingTable } from "../redaction/mapping.js";
import { viewportToImage } from "../redaction/geometry.js";
import type { DetectorBox } from "../redaction/types.js";

export interface AssembleArgs {
  task: string;
  image: { w: number; h: number; dpr: number };
  domRegions: Region[];
  domSensitive: { bbox: [number, number, number, number]; category: PiiCategory }[];
  faces: [number, number, number, number][];
  ocrWords: { text: string; bbox: [number, number, number, number] }[];
  ocrJoined: string;
  ocrOffsets: number[];
  nerSpans: { category: PiiCategory; value: string; start: number; end: number }[];
  degraded: boolean;
  mapping?: MappingTable;
  detectorBoxes?: DetectorBox[];
}

export interface AssembleResult {
  classified: ClassifiedRegion[];
  manifest: RedactionManifest;
  mapping: MappingTable;
}

export function assemblePerception(args: AssembleArgs): AssembleResult {
  const mapping = args.mapping ?? new MappingTable();
  const dpr = args.image.dpr;

  // DOM/face bboxes are CSS px; OCR/detector bboxes are already image px.
  const domRegionsImg: Region[] = args.domRegions.map((r) => ({ ...r, bbox: viewportToImage(r.bbox, dpr) }));
  const domSensitiveImg = args.domSensitive.map((d) => ({
    bbox: viewportToImage(d.bbox, dpr), category: d.category, value: null, confidence: 1, detected_by: ["dom" as const],
  }));
  const facesImg = args.faces.map((f) => viewportToImage(f, dpr));

  const fused = fuseRegions({
    regions: domRegionsImg,
    domSensitive: domSensitiveImg,
    faces: facesImg,
    ocrWords: args.ocrWords,
    nerSpans: args.nerSpans,
    ocrJoined: args.ocrJoined,
    ocrOffsets: args.ocrOffsets,
    pageSensitive: args.domSensitive.some((d) => d.category === "PASSWORD"),
    detectorBoxes: args.detectorBoxes,
  });

  const classified = fused.map((r) => classify(r, args.task, domRegionsImg));

  const elements: ElementInput[] = domRegionsImg.map((r) => ({
    id: r.id, bbox: r.bbox, role: r.role, text: r.name, interactable: r.interactable,
  }));

  const manifest = buildManifest({ image: args.image, elements, redacted: classified, mapping, degraded: args.degraded });
  return { classified, manifest, mapping };
}
