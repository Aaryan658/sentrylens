import type { BBox } from "@sentrylens/shared";
import { unionBox } from "./geometry.js";

/**
 * OCR does not fail only by reading nothing. It also reads the WRONG thing:
 * a card number came back as "A111 1111111 1111" (a lookalike letter and a
 * dropped digit) and an email as "ops.lead@vssc test" (the dot lost). Those
 * fail every validator, and because OCR "read something" there the text-
 * likelihood backstop treats the spot as legible, so the identifier stayed
 * visible in the image sent to the server. These helpers recognise the
 * signature of such misreads so fuse.ts can fail closed on them.
 *
 * They deliberately do NOT flag clean text: a regularly grouped number that
 * merely fails a checksum (a sample card on a docs page) is left alone.
 */
export interface OcrWordBox { text: string; bbox: BBox }

// Characters OCR commonly returns for a digit (4->A, 0->O/D/Q, 1->I/l/|, 5->S,
// 8->B, 2->Z, 6->G, 7->T, 9->g/q).
const DIGIT_LIKE = /[0-9OoDQIl|SsBZzGTAgq]/;

function sameRow(a: BBox, b: BBox): boolean {
  const overlap = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return overlap > 0.4 * Math.min(a[3], b[3]);
}

/** True when `next` continues the same line as `prev` closely enough to be one value. */
function adjacent(prev: BBox, next: BBox): boolean {
  const maxGap = Math.max(24, 2 * Math.max(prev[3], next[3]));
  const gap = next[0] - (prev[0] + prev[2]);
  return sameRow(prev, next) && gap >= -4 && gap <= maxGap;
}

const stripEdges = (s: string) => s.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, "");

/** A token that looks like part of a number: some real digit, and mostly digit-like characters. */
function numericToken(text: string): string | null {
  const t = stripEdges(text);
  if (!/^[0-9A-Za-z]+$/.test(t) || !/[0-9]/.test(t)) return null;
  const digitLike = [...t].filter((c) => DIGIT_LIKE.test(c)).length;
  return digitLike / t.length >= 0.75 ? t : null;
}

const MIN_IDENTIFIER_DIGITS = 11; // an Aadhaar (12) or card (13-19) with one digit lost

/**
 * Boxes of runs of numeric words that look like a MISREAD long identifier: at
 * least 11 real digits across the run, and either a lookalike letter among the
 * digits ("A111") or irregular grouping (8+4+4, 12+3). Regular 4-digit grouping
 * and a single unbroken token are treated as clean.
 */
interface NumericRun { toks: string[]; box: BBox; digits: number; hasLookalike: boolean; allFour: boolean }

/** Runs of 2+ adjacent numeric-looking words on one line (>= 11 real digits). */
function numericRuns(words: OcrWordBox[]): NumericRun[] {
  const out: NumericRun[] = [];
  let run: { tok: string; box: BBox }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const digits = run.reduce((n, r) => n + [...r.tok].filter((c) => /[0-9]/.test(c)).length, 0);
      if (digits >= MIN_IDENTIFIER_DIGITS) {
        out.push({
          toks: run.map((r) => r.tok), box: unionBox(run.map((r) => r.box)), digits,
          hasLookalike: run.some((r) => /[^0-9]/.test(r.tok)),
          allFour: run.every((r) => r.tok.length === 4),
        });
      }
    }
    run = [];
  };
  for (const w of words) {
    const tok = numericToken(w.text);
    if (!tok) { flush(); continue; }
    const prev = run[run.length - 1];
    if (prev && !adjacent(prev.box, w.bbox)) flush();
    run.push({ tok, box: w.bbox });
  }
  flush();
  return out;
}

export function findSuspectNumericRuns(words: OcrWordBox[]): BBox[] {
  const runs = numericRuns(words).filter((r) => r.hasLookalike || !r.allFour).map((r) => r.box);
  // A single garbled token: a phone number read as "gooooo0000" (9->g, 0->o).
  // Nearly every character is digit-like, at least two are lookalike LETTERS, and
  // there is a real digit, which ordinary words and real identifiers do not have
  // (a PAN is ~70% digit-like, a plain digit run has no lookalike letters).
  for (const w of words) {
    const t = stripEdges(w.text);
    if (t.length < 9 || !/^[0-9A-Za-z]+$/.test(t) || !/[0-9]/.test(t)) continue;
    const chars = [...t];
    const digitLike = chars.filter((c) => DIGIT_LIKE.test(c)).length;
    const lookalikeLetters = chars.filter((c) => /[^0-9]/.test(c) && DIGIT_LIKE.test(c)).length;
    if (digitLike / chars.length >= 0.9 && lookalikeLetters >= 2) runs.push(w.bbox);
  }
  return runs;
}

/**
 * Clean, regularly grouped digit runs (4x4 card, 4x3 Aadhaar). These are NOT
 * masked outright, because a checksum-failing regular number is usually a sample
 * on a docs page. But a misread that only changes a digit looks exactly like
 * that, so the caller verifies each one by re-reading it at other scales: if a
 * reading passes Luhn/Verhoeff it was a real number, otherwise it is left alone.
 */
export function findRegularNumericRuns(words: OcrWordBox[]): { box: BBox; text: string }[] {
  return numericRuns(words)
    .filter((r) => !r.hasLookalike && r.allFour && r.toks.length >= 3 && r.digits <= 19)
    .map((r) => ({ box: r.box, text: r.toks.join(" ") }));
}

const COMPLETE_EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}[.,;:]?$/;

/**
 * Boxes of a word containing "@" that is NOT a complete address (OCR dropped
 * the dot: "ops.lead@vssc test"), widened to the following word on the same
 * line, which is where the lost domain suffix ended up. Complete addresses are
 * left to the regular email detector.
 */
export function findSuspectEmailFragments(words: OcrWordBox[]): BBox[] {
  const out: BBox[] = [];
  for (let i = 0; i < words.length; i++) {
    const t = words[i]!.text;
    if (!/[A-Za-z0-9][^@\s]*@/.test(t) || COMPLETE_EMAIL.test(t)) continue;
    const next = words[i + 1];
    out.push(next && adjacent(words[i]!.bbox, next.bbox) ? unionBox([words[i]!.bbox, next.bbox]) : words[i]!.bbox);
  }
  return out;
}
