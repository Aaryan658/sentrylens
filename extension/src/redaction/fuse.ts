import type { PiiCategory } from "@sentrylens/shared";
import { iou, unionBox } from "./geometry.js";
import { findStructuredPii } from "./validators.js";
import type { PerceptionInputs, SensitiveRegion } from "./types.js";

function wordsForSpan(inp: PerceptionInputs, start: number, end: number) {
  const boxes = [];
  for (let i = 0; i < inp.ocrWords.length; i++) {
    const wStart = inp.ocrOffsets[i]!;
    const wEnd = wStart + inp.ocrWords[i]!.text.length;
    if (wStart < end && wEnd > start) boxes.push(inp.ocrWords[i]!.bbox);
  }
  return boxes;
}

const PREC: PiiCategory[] = [
  "PASSWORD", "AADHAAR", "CREDIT_CARD", "PAN", "API_KEY", "GOV_ID", "IFSC",
  "BANK_ACCOUNT", "EMAIL", "PHONE_NUMBER", "DOB", "ADDRESS", "PERSON_NAME",
  "IP_ADDRESS", "FACE", "OTHER",
];
const prec = (c: PiiCategory) => { const i = PREC.indexOf(c); return i < 0 ? PREC.length : i; };

export function fuseRegions(inp: PerceptionInputs): SensitiveRegion[] {
  const raw: SensitiveRegion[] = [];

  for (const d of inp.domSensitive) raw.push(d);

  for (const f of inp.faces) {
    raw.push({ bbox: f, category: "FACE", value: null, confidence: inp.pageSensitive ? 0.95 : 0.8, detected_by: ["face"] });
  }

  for (const span of inp.nerSpans) {
    const boxes = wordsForSpan(inp, span.start, span.end);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: span.category, value: span.value, confidence: 0.75, detected_by: ["ocr+ner"] });
  }

  for (const hit of findStructuredPii(inp.ocrJoined)) {
    const boxes = wordsForSpan(inp, hit.start, hit.end);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: hit.category, value: hit.value, confidence: 0.9, detected_by: ["regex"] });
  }

  const out: SensitiveRegion[] = [];
  for (const r of raw) {
    const hit = out.find((o) => iou(o.bbox, r.bbox) > 0.6);
    if (!hit) { out.push({ ...r, detected_by: [...r.detected_by] }); continue; }
    for (const s of r.detected_by) if (!hit.detected_by.includes(s)) hit.detected_by.push(s);
    hit.confidence = Math.max(hit.confidence, r.confidence);
    if (prec(r.category) < prec(hit.category)) { hit.category = r.category; hit.value = r.value; }
  }
  return out;
}
