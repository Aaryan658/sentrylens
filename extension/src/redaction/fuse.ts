import type { BBox, PiiCategory } from "@sentrylens/shared";
import { iou, unionBox, mergeRowBoxes } from "./geometry.js";
import { findStructuredPii, findStructuredPiiDespaced } from "./validators.js";
import { findLabeledNames } from "./names.js";
import { inferCategoryFromLabel } from "./label-context.js";
import { findSuspectNumericRuns, findSuspectEmailFragments } from "./suspect.js";
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

  // Catches digit-by-digit-spaced PII ("9 1 2 3 4 5 6 7 8 0") that the
  // direct regex pass above misses once OCR emits each digit as its own
  // word — see findStructuredPiiDespaced's doc comment.
  for (const hit of findStructuredPiiDespaced(inp.ocrJoined)) {
    const boxes = wordsForSpan(inp, hit.start, hit.end);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: hit.category, value: hit.value, confidence: 0.85, detected_by: ["regex"] });
  }

  // Deterministic backstop for the NER model's inconsistent recall on
  // "Initial. Surname"-shaped names in OCR text (see names.ts). Runs after
  // findStructuredPii so a genuine NER/regex hit on the same span (IoU>0.6,
  // deduped below) still wins precedence via PREC — this only fills gaps.
  for (const hit of findLabeledNames(inp.ocrJoined)) {
    const boxes = wordsForSpan(inp, hit.start, hit.end, hit.value);
    if (boxes.length === 0) continue;
    raw.push({ bbox: unionBox(boxes), category: hit.category, value: hit.value, confidence: 0.7, detected_by: ["regex"] });
  }

  // Scoped second-pass OCR rescue results (see ocr-rescue.ts). Pushed BEFORE
  // the fail-closed heuristic loop below so a rescued hit lands in `out`
  // first; the heuristic loop's identical-bbox entry then merges into it
  // (IoU>0.6), unioning in the "heuristic" tag rather than replacing this
  // region — the safety property classify.ts depends on (forced high risk
  // for anything ever flagged as an OCR blind spot) must survive intact
  // even when the value WAS successfully recovered.
  for (const r of inp.rescuedRegions ?? []) {
    raw.push({ bbox: r.bbox, category: r.category, value: r.value, confidence: 0.6, detected_by: ["ocr+ner"] });
  }

  // Fail-closed backstop for OCR blind spots: a text-likelihood candidate
  // (see text-likelihood.ts) only becomes a redacted region when NO OCR
  // word overlaps it at all — i.e. Tesseract read nothing there. If OCR did
  // read something, that's ordinary legible text (which also has high
  // local variance) already handled by the passes above; redacting it too
  // would over-mask normal content. There is no value to redact here (we
  // don't know what it says), so it is positional-only, like FACE.
  // Filter to genuine per-fragment blind spots BEFORE merging: checking
  // ocrCovered on an already-merged row box would let one legitimately-read
  // OCR word (e.g. an adjacent label) that got merged in alongside a truly
  // blind fragment mark the WHOLE row "covered" and skip it entirely —
  // losing fail-closed protection on the genuinely blind part. Merging only
  // AFTER filtering (same order ocr-rescue.ts's caller must use — see
  // mergeRowBoxes's doc comment) turns text-likelihood's per-character
  // fragments (see docs/EVAL_RESULTS.md) into one box per text line, so a
  // single contiguous redaction replaces several small ones that could
  // otherwise leave thin unmasked gaps between fragments.
  const blindSpots = (inp.textLikelihoodBoxes ?? []).filter(
    (box) => !inp.ocrWords.some((w) => iou(w.bbox, box) > 0),
  );
  for (const box of mergeRowBoxes(blindSpots)) {
    // The value is genuinely unrecoverable (OCR read nothing here), but the
    // category sometimes is: a nearby legible label ("Aadhaar:", "Operator")
    // narrows what this blind spot probably is, so the downstream agent can
    // reason about task-relevance instead of always seeing bare OTHER.
    const category = inferCategoryFromLabel(box, inp.ocrWords) ?? "OTHER";
    raw.push({ bbox: box, category, value: null, confidence: 0.5, detected_by: ["heuristic"] });
  }

  // OCR can also read the WRONG thing (see suspect.ts): a misread identifier
  // fails every validator, and since OCR "read" it, the blind-spot pass above
  // treats it as legible. Recognise the misread's signature and fail closed.
  for (const box of findSuspectNumericRuns(inp.ocrWords)) {
    raw.push({ bbox: box, category: "OTHER", value: null, confidence: 0.5, detected_by: ["heuristic"] });
  }
  for (const box of findSuspectEmailFragments(inp.ocrWords)) {
    raw.push({ bbox: box, category: "EMAIL", value: null, confidence: 0.5, detected_by: ["heuristic"] });
  }

  const out: SensitiveRegion[] = [];
  for (const r of raw) {
    const hit = out.find((o) => iou(o.bbox, r.bbox) > 0.6);
    if (!hit) { out.push({ ...r, detected_by: [...r.detected_by] }); continue; }
    for (const s of r.detected_by) if (!hit.detected_by.includes(s)) hit.detected_by.push(s);
    hit.confidence = Math.max(hit.confidence, r.confidence);
    if (prec(r.category) < prec(hit.category)) { hit.category = r.category; hit.value = r.value; }
  }
  // A blind-spot box that sits entirely inside some other redacted region is
  // already masked by it: keeping it adds no coverage, only a duplicate region
  // (e.g. the dots inside a DOM-flagged password field).
  const compact = (s: string) => s.replace(/\s+/g, "");
  return out.filter((r) => {
    // ...and a value that is just a fragment of the full value another region
    // already carries over a box that contains it (NER tagging "41" inside a
    // card number): no extra coverage, and a meaningless placeholder.
    if (r.value != null && out.some((o) => o !== r && o.value != null && compact(o.value).length > compact(r.value!).length && compact(o.value).includes(compact(r.value!)) && contains(o.bbox, r.bbox))) return false;
    return !(r.detected_by.length === 1 && r.detected_by[0] === "heuristic") || !out.some((o) => o !== r && contains(o.bbox, r.bbox));
  });
}

const CONTAIN_TOLERANCE = 2;
function contains(outer: BBox, inner: BBox): boolean {
  return (
    inner[0] >= outer[0] - CONTAIN_TOLERANCE &&
    inner[1] >= outer[1] - CONTAIN_TOLERANCE &&
    inner[0] + inner[2] <= outer[0] + outer[2] + CONTAIN_TOLERANCE &&
    inner[1] + inner[3] <= outer[1] + outer[3] + CONTAIN_TOLERANCE
  );
}
