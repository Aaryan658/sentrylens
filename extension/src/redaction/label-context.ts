import type { BBox, PiiCategory } from "@sentrylens/shared";
import { PERSON_LABELS } from "./personLabels.js";
import { unionBox } from "./geometry.js";

// Non-person labels first; PERSON_LABELS is merged in after and wins on any
// key collision (e.g. bare "contact"), so this stays consistent with
// findLabeledNames' established "contact" -> PERSON_NAME behavior instead of
// silently reinterpreting it as a phone-number label.
// Deliberately NOT included: bare "pin" — ambiguous between a security PIN
// (PASSWORD-like) and a postal PIN code (part of ADDRESS), and guessing
// wrong here is worse than not guessing (see label-context.test.ts).
const LABEL_CATEGORY: Record<string, PiiCategory> = {
  password: "PASSWORD",
  pwd: "PASSWORD",
  passcode: "PASSWORD",
  aadhaar: "AADHAAR",
  aadhar: "AADHAAR", // common misspelling
  uid: "AADHAAR",
  "aadhaar no": "AADHAAR",
  "aadhaar number": "AADHAAR",
  pan: "PAN",
  "pan no": "PAN",
  "pan number": "PAN",
  card: "CREDIT_CARD",
  "credit card": "CREDIT_CARD",
  "debit card": "CREDIT_CARD",
  "card no": "CREDIT_CARD",
  "card number": "CREDIT_CARD",
  ifsc: "IFSC",
  "ifsc code": "IFSC",
  account: "BANK_ACCOUNT",
  "bank account": "BANK_ACCOUNT",
  ac: "BANK_ACCOUNT", // OCR text of "A/C" after normalize() strips the slash
  "ac no": "BANK_ACCOUNT",
  "account no": "BANK_ACCOUNT",
  "account number": "BANK_ACCOUNT",
  phone: "PHONE_NUMBER",
  mobile: "PHONE_NUMBER",
  mob: "PHONE_NUMBER",
  "mob no": "PHONE_NUMBER",
  "phone no": "PHONE_NUMBER",
  "contact no": "PHONE_NUMBER",
  "contact number": "PHONE_NUMBER",
  telephone: "PHONE_NUMBER",
  email: "EMAIL",
  "mail id": "EMAIL",
  dob: "DOB",
  "date of birth": "DOB",
  "birth date": "DOB",
  address: "ADDRESS",
  addr: "ADDRESS",
  "residential address": "ADDRESS",
  "gov id": "GOV_ID",
  passport: "GOV_ID",
  "passport no": "GOV_ID",
  "voter id": "GOV_ID",
  "driving licence": "GOV_ID",
  "driving license": "GOV_ID",
  "api key": "API_KEY",
  token: "API_KEY",
  secret: "API_KEY",
  "access token": "API_KEY",
  "auth token": "API_KEY",
  "secret key": "API_KEY",
};
for (const label of PERSON_LABELS) LABEL_CATEGORY[label] = "PERSON_NAME";

const MAX_LABEL_WORDS = 3;
// A label and its value on the same row are often separated by wide
// whitespace (form alignment, OCR word gaps), so this is generous.
const MAX_SAME_ROW_GAP = 120;
// A label ABOVE its value (label-over-input forms) sits about one line above;
// anything further up is a different field's label, not this one's.
const MAX_ABOVE_GAP = 24;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

/**
 * How far `label` is from `box` if it plausibly labels it, else null. A label
 * precedes its value: it is either to the left on the same row, or directly
 * above. Anything else (a different row, below, to the right) is not this
 * blind spot's label; guessing from it mislabels the region.
 */
function labelDistance(label: BBox, box: BBox): number | null {
  const [lx, ly, lw, lh] = label;
  const [bx, by, bw, bh] = box;
  const rowOverlap = Math.min(ly + lh, by + bh) - Math.max(ly, by);
  if (rowOverlap > 0.4 * Math.min(lh, bh)) {
    const gap = bx - (lx + lw);
    return gap >= -4 && gap <= MAX_SAME_ROW_GAP ? Math.max(0, gap) : null;
  }
  const colOverlap = Math.min(lx + lw, bx + bw) - Math.max(lx, bx);
  const gap = by - (ly + lh);
  if (colOverlap > 0 && gap >= -4 && gap <= MAX_ABOVE_GAP) return Math.max(0, gap);
  return null;
}

/**
 * Infers a PII category for a region OCR could not read (a text-likelihood
 * blind spot — see fuse.ts's "heuristic" pass) from a legible label word
 * found near it, the same way names.ts's findLabeledNames infers PERSON_NAME
 * from a preceding label in ordinary OCR text. Only the category is
 * recoverable this way, never the value: OCR read nothing in the blind spot
 * itself. Returns null rather than guessing when no known label is nearby.
 */
export function inferCategoryFromLabel(
  box: BBox,
  ocrWords: { text: string; bbox: BBox }[],
): PiiCategory | null {
  let best: { category: PiiCategory; distance: number } | null = null;
  for (let i = 0; i < ocrWords.length; i++) {
    for (let len = 1; len <= MAX_LABEL_WORDS && i + len <= ocrWords.length; len++) {
      const span = ocrWords.slice(i, i + len);
      const text = normalize(span.map((w) => w.text).join(" "));
      const category = LABEL_CATEGORY[text];
      if (!category) continue;
      const distance = labelDistance(unionBox(span.map((w) => w.bbox)), box);
      if (distance !== null && (!best || distance < best.distance)) best = { category, distance };
    }
  }
  return best?.category ?? null;
}
