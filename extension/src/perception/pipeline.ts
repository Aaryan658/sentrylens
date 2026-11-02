import type { BBox, Region, RedactionManifest, PiiCategory } from "@sentrylens/shared";
import { fuseRegions } from "../redaction/fuse.js";
import { classify, type ClassifiedRegion } from "../redaction/classify.js";
import { buildManifest, type ElementInput } from "../redaction/manifest.js";
import { MappingTable } from "../redaction/mapping.js";
import { scrubElementText } from "../redaction/element-text.js";
import { viewportToImage } from "../redaction/geometry.js";
import type { DetectorBox } from "../redaction/types.js";

export interface AssembleArgs {
  task: string;
  image: { w: number; h: number; dpr: number };
  domRegions: Region[];
  domSensitive: { bbox: [number, number, number, number]; category: PiiCategory }[];
  /** face boxes in IMAGE pixels, as MediaPipe reports them (not CSS px) */
  faces: [number, number, number, number][];
  ocrWords: { text: string; bbox: [number, number, number, number] }[];
  ocrJoined: string;
  ocrOffsets: number[];
  nerSpans: { category: PiiCategory; value: string; start: number; end: number }[];
  degraded: boolean;
  mapping?: MappingTable;
  detectorBoxes?: DetectorBox[];
  textLikelihoodBoxes?: BBox[];
  rescuedRegions?: { bbox: BBox; category: PiiCategory; value: string }[];
}

export interface AssembleResult {
  classified: ClassifiedRegion[];
  manifest: RedactionManifest;
  mapping: MappingTable;
}

const containsBox = (outer: BBox, inner: BBox, tol = 4) =>
  inner[0] >= outer[0] - tol && inner[1] >= outer[1] - tol &&
  inner[0] + inner[2] <= outer[0] + outer[2] + tol && inner[1] + inner[3] <= outer[1] + outer[3] + tol;

export function assemblePerception(args: AssembleArgs): AssembleResult {
  const mapping = args.mapping ?? new MappingTable();
  const dpr = args.image.dpr;

  // DOM bboxes are CSS px and need scaling. OCR, face (MediaPipe runs on the
  // screenshot bitmap) and detector bboxes are already image px: scaling faces
  // again put every FACE mask in the wrong place on any display with dpr != 1,
  // leaving the actual face visible.
  const domRegionsImg: Region[] = args.domRegions.map((r) => ({ ...r, bbox: viewportToImage(r.bbox, dpr) }));
  const domSensitiveImg = args.domSensitive.map((d) => ({
    bbox: viewportToImage(d.bbox, dpr), category: d.category, value: null, confidence: 1, detected_by: ["dom" as const],
  }));
  const facesImg = args.faces;

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
    textLikelihoodBoxes: args.textLikelihoodBoxes,
    rescuedRegions: args.rescuedRegions,
  });

  // A blind-spot box inside a control whose DOM name is clean is that control's
  // caption (white-on-blue button text OCR cannot read). Label the mask with the
  // name; the manifest already carries it as element text, so nothing new leaks.
  const classified = fused.map((r) => {
    const c = classify(r, args.task, domRegionsImg);
    if (c.value != null || c.detected_by.length !== 1 || c.detected_by[0] !== "heuristic") return c;
    const el = domRegionsImg.find(
      (e) => e.interactable && e.name && containsBox(e.bbox, c.bbox) && scrubElementText(e.name, mapping) === e.name,
    );
    return el ? { ...c, caption: el.name.slice(0, 40) } : c;
  });

  const elements: ElementInput[] = domRegionsImg.map((r) => ({
    // The DOM name is sent to the server as plain text; scrub it like pixels.
    id: r.id, bbox: r.bbox, role: r.role, text: scrubElementText(r.name, mapping), interactable: r.interactable,
  }));

  const manifest = buildManifest({ image: args.image, elements, redacted: classified, mapping, degraded: args.degraded });
  return { classified, manifest, mapping };
}
