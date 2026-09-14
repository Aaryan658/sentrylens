import type { PiiCategory } from "@sentrylens/shared";

const NUMERIC: PiiCategory[] = ["PHONE_NUMBER", "AADHAAR", "CREDIT_CARD", "BANK_ACCOUNT", "IP_ADDRESS", "GOV_ID"];

// Mirrors redaction/mapping.ts's normalise() (numeric categories compare by
// digits only, everything else by trimmed/lowercased/whitespace-collapsed
// text) so a ground-truth value matches a mapping-resolved value the same
// way the mapping table itself would treat them as "the same entity".
// Well-known OCR glyph ambiguities (capital I / lowercase l / digit 1 are
// visually identical in many sans-serif fonts; same for O / 0) — folded
// before comparing so a value this system correctly redacted isn't counted
// as "leaked" just because OCR read one letter differently than the fixture
// text specifies. This measures the real privacy property (was it
// redacted?), not OCR transcription accuracy.
const foldOcrHomoglyphs = (s: string) => s.replace(/[Il1]/g, "i").replace(/[O0]/g, "o");

export function matchValue(resolved: string, groundTruth: string, category: PiiCategory): boolean {
  if (NUMERIC.includes(category)) {
    return resolved.replace(/\D/g, "") === groundTruth.replace(/\D/g, "");
  }
  const norm = (s: string) => foldOcrHomoglyphs(s.trim().replace(/\s+/g, " ").toLowerCase());
  return norm(resolved) === norm(groundTruth);
}
