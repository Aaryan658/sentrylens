import type { PiiCategory } from "@sentrylens/shared";
import { PERSON_LABELS } from "./personLabels.js";
import type { StructuredHit } from "./validators.js";

// Longer labels first ("employee name" before "employee") so the alternation
// doesn't stop short and leave the rest of a compound label ("Name") to be
// mistaken for the start of the person's own name.
const LABEL_ALT = [...PERSON_LABELS]
  .sort((a, b) => b.length - a.length)
  .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const LABEL_RE = new RegExp(`\\b(?:${LABEL_ALT})\\b\\s*:?\\s*`, "gi");
// Capped at 2 tokens ("A." + "Menon", or "Anita" + "Rao"): OCR-joined screen
// text has no punctuation between adjacent fields, so an uncapped pattern
// greedily swallows the next field's capitalized label too — e.g. matching
// "R. Iyer Phone" instead of "R. Iyer" out of "Operator R. Iyer Phone ...".
// Leading char allows "l" alongside real capitals: at typical OCR sizes a
// capital "I" and lowercase "l" are visually identical in sans-serif fonts
// (confirmed live: tesseract read "Iyer" as "lyer"), so a name-shaped token
// starting with a lone "l" is, in practice, almost always a misread "I".
const NAME_RE = /^[A-Zl][a-zA-Z]*\.?(?:\s+[A-Zl][a-zA-Z]*\.?){0,1}/;

/**
 * Deterministic backstop for the on-device NER model's inconsistent recall
 * on "Initial. Surname"-shaped names: a live probe against
 * onnx-community/multilang-pii-ner-ONNX found it tags "A. Menon" correctly
 * in isolation but returns zero entities once a label like "Operator"
 * precedes it (see docs/EVAL_RESULTS.md). This is the OCR-text equivalent of
 * dom/walk.ts's DOM table-row fallback, for screens with no real DOM table
 * (synthetic screenshots, canvas-rendered content, non-tabular layouts).
 * Scans OCR text for a known person-label immediately followed by a
 * capitalized name-shaped span.
 */
export function findLabeledNames(text: string): StructuredHit[] {
  const hits: StructuredHit[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text)) !== null) {
    const afterLabel = m.index + m[0].length;
    const nm = NAME_RE.exec(text.slice(afterLabel));
    if (!nm) continue;
    const value = nm[0].trim();
    if (!value) continue;
    hits.push({ category: "PERSON_NAME" as PiiCategory, value, start: afterLabel, end: afterLabel + nm[0].length });
  }
  return hits;
}
