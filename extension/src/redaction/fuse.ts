import type { PiiCategory } from "@sentrylens/shared";
import { iou, unionBox } from "./geometry.js";
import { findStructuredPii } from "./validators.js";
import type { PerceptionInputs, SensitiveRegion } from "./types.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@.]/g, "");

function wordsForSpan(inp: PerceptionInputs, start: number, end: number, value?: string) {
  const boxes = [];
  for (let i = 0; i < inp.ocrWords.length; i++) {
    const wStart = inp.ocrOffsets[i]!;
    const wEnd = wStart + inp.ocrWords[i]!.text.length;
    if (wStart < end && wEnd > start) boxes.push(inp.ocrWords[i]!.bbox);
  }
  // The NER model can renormalise whitespace/punctuation, so its char offsets
  // may not line up with ocrJoined. Fall back to matching the span's own tokens
  // against OCR words so a real hit (esp. PERSON_NAME) still gets a box.
  if (boxes.length === 0 && value) {
    const want = value.split(/\s+/).map(norm).filter((t) => t.length > 1);
    if (want.length) {
      for (const w of inp.ocrWords) if (want.includes(norm(w.text))) boxes.push(w.bbox);
    }
  }
  return boxes;
}

const PREC: PiiCategory[] = [
  "PASSWORD", "AADHAAR", "CREDIT_CARD", "PAN", "API_KEY", "GOV_ID", "IFSC",
  "BANK_ACCOUNT", "EMAIL", "PHONE_NUMBER", "DOB", "ADDRESS", "PERSON_NAME",
  "IP_ADDRESS", "FACE", "BYSTANDER_SCREEN", "OTHER",
];
const prec = (c: PiiCategory) => { const i = PREC.indexOf(c); return i < 0 ? PREC.length : i; };

// COCO classes yolos-tiny can report that indicate someone else's device
// (and possibly their own screen) is visible in frame — not PII itself, but
// a privacy-relevant redaction the DOM/OCR/face signals can't catch.
const BYSTANDER_LABELS = new Set(["cell phone", "laptop", "tv"]);
const DETECTOR_MIN_SCORE = 0.5;

export function fuseRegions(inp: PerceptionInputs): SensitiveRegion[] {
  const raw: SensitiveRegion[] = [];

  for (const d of inp.domSensitive) raw.push(d);

  for (const f of inp.faces) {
    raw.push({ bbox: f, category: "FACE", value: null, confidence: inp.pageSensitive ? 0.95 : 0.8, detected_by: ["face"] });
  }

  // yolos-tiny is supplementary: bystander devices are never a PII source of
  // truth (no value to redact, positional-only), and a detected person only
  // fills in when MediaPipe found zero faces — it must never double-count a
  // face MediaPipe already caught.
  for (const d of inp.detectorBoxes ?? []) {
    if (d.score < DETECTOR_MIN_SCORE) continue;
    if (BYSTANDER_LABELS.has(d.label)) {
      raw.push({ bbox: d.bbox, category: "BYSTANDER_SCREEN", value: null, confidence: d.score, detected_by: ["detector"] });
    } else if (d.label === "person" && inp.faces.length === 0) {
      raw.push({ bbox: d.bbox, category: "FACE", value: null, confidence: Math.min(0.6, d.score), detected_by: ["detector"] });
    }
  }

  for (const span of inp.nerSpans) {
    const boxes = wordsForSpan(inp, span.start, span.end, span.value);
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
