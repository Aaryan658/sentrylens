import type { BBox, PiiCategory } from "@sentrylens/shared";
import { findStructuredPii, findStructuredPiiDespaced } from "../redaction/validators.js";
import { findLabeledNames } from "../redaction/names.js";
import { findRegularNumericRuns } from "../redaction/suspect.js";
import { mergeRowBoxes, residualBlindSpots } from "../redaction/geometry.js";
import type { RawImage } from "./text-likelihood.js";

export interface RescueCropOptions {
  /** Extra pixels of margin around the box before upscaling, clamped to image bounds. */
  padding?: number;
  /** Integer nearest-neighbor upscale factor applied after cropping. */
  upscale?: number;
}

// upscale=5: empirically the factor that resolved a real 8px tiny-font
// crop exactly, consistently across every padding value tried; 6+ was
// measurably WORSE and consistently misread "2" as "Z" (interpolation
// artifacts at that specific scale, not a monotonic quality/scale
// relationship) — see docs/EVAL_RESULTS.md for the measured sweep.
const DEFAULTS: Required<RescueCropOptions> = { padding: 8, upscale: 5 };

// A single fixed factor generalizes badly: 5x was the empirical winner for
// an 8px source font, but that's a property of THIS font size, not a
// universal constant — a smaller or larger blind spot needs a different
// factor, and rescueBlindSpot has no way to know the true source size in
// advance (that's exactly what OCR failed to tell it). Trying a small
// spread and keeping whichever one VALIDATES (see rescueBlindSpot) is more
// robust than trusting any single guess, at the cost of up to this many
// extra OCR calls on an already-small, already-rare crop.
export const RESCUE_CANDIDATES: RescueCropOptions[] = [
  { padding: 8, upscale: 5 },
  { padding: 8, upscale: 3 },
  { padding: 8, upscale: 8 },
];

/**
 * Second-pass OCR input for a single text-likelihood blind spot (see
 * text-likelihood.ts / fuse.ts's "heuristic" pass): the whole-image OCR
 * pass already failed here, but a whole-image contrast/upscale retry was
 * tried previously and reverted for regressing unrelated, already-working
 * detections elsewhere in the image (see docs/EVAL_RESULTS.md). Scoping the
 * same idea to just the flagged box removes that failure mode structurally
 * — this function only ever reads/writes pixels inside the box, so it
 * cannot affect OCR anywhere else in the image, at the cost of only being
 * able to rescue what's inside this one region.
 *
 * Contrast stretch is local-min/max over the crop itself (not the whole
 * image), which is exactly why this works on near-invisible text: a
 * 242-248 gray-on-white patch has almost no *global* contrast but nearly
 * full *local* contrast once isolated from the rest of the page.
 */
export function prepareRescueCrop(img: RawImage, box: BBox, opts: RescueCropOptions = {}): RawImage {
  const { padding, upscale } = { ...DEFAULTS, ...opts };
  const [bx, by, bw, bh] = box;

  const x0 = Math.max(0, Math.floor(bx - padding));
  const y0 = Math.max(0, Math.floor(by - padding));
  const x1 = Math.min(img.width, Math.ceil(bx + bw + padding));
  const y1 = Math.min(img.height, Math.ceil(by + bh + padding));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  // Grayscale + local min/max in one pass over just the crop.
  const gray = new Float64Array(cw * ch);
  let min = 255, max = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * img.width + (x0 + x)) * img.channels;
      const g = 0.299 * img.data[si]! + 0.587 * img.data[si + 1]! + 0.114 * img.data[si + 2]!;
      gray[y * cw + x] = g;
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  const range = max - min;

  // Bilinear, not nearest-neighbor: nearest-neighbor just replicates each
  // source pixel into a hard-edged block, which reads as jagged/blocky at
  // these upscale factors and measurably hurt recognition on real tiny-font
  // text (see docs/EVAL_RESULTS.md) — bilinear blends across glyph edges,
  // closer to what a higher-resolution capture would have looked like.
  const outW = cw * upscale;
  const outH = ch * upscale;
  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let oy = 0; oy < outH; oy++) {
    const sy = Math.min(ch - 1, Math.max(0, (oy + 0.5) / upscale - 0.5));
    const sy0 = Math.floor(sy);
    const sy1 = Math.min(ch - 1, sy0 + 1);
    const fy = sy - sy0;
    for (let ox = 0; ox < outW; ox++) {
      const sx = Math.min(cw - 1, Math.max(0, (ox + 0.5) / upscale - 0.5));
      const sx0 = Math.floor(sx);
      const sx1 = Math.min(cw - 1, sx0 + 1);
      const fx = sx - sx0;
      const g00 = gray[sy0 * cw + sx0]!, g01 = gray[sy0 * cw + sx1]!;
      const g10 = gray[sy1 * cw + sx0]!, g11 = gray[sy1 * cw + sx1]!;
      const g = (g00 * (1 - fx) + g01 * fx) * (1 - fy) + (g10 * (1 - fx) + g11 * fx) * fy;
      // range===0: a perfectly flat crop has no contrast to stretch (and no
      // text either); pass the value through unchanged rather than divide by zero.
      const v = range > 0 ? ((g - min) / range) * 255 : g;
      const di = (oy * outW + ox) * 4;
      out[di] = out[di + 1] = out[di + 2] = v;
      out[di + 3] = 255;
    }
  }

  return { data: out, width: outW, height: outH, channels: 4 };
}

/**
 * Runs the same structured-PII / NER / labeled-name detectors fuse.ts uses
 * on ordinary OCR text, but against text recovered from a single rescued
 * crop. Only ever returns a category+value pulled from a real detector hit
 * — never invents one — so a rescue that reads garbage (misOCR'd noise)
 * naturally yields null here and the caller falls back to the existing
 * fail-closed heuristic path, exactly as if the rescue had never been
 * attempted.
 */
export function extractRescuedPii(cropJoined: string): { category: PiiCategory; value: string } | null {
  if (!cropJoined.trim()) return null;
  const structured = findStructuredPii(cropJoined)[0] ?? findStructuredPiiDespaced(cropJoined)[0];
  if (structured) return { category: structured.category, value: structured.value };
  const labeled = findLabeledNames(cropJoined)[0];
  if (labeled) return { category: labeled.category, value: labeled.value };
  // Deliberately NO NER fallback. Only checksum/pattern-validated hits and
  // label-anchored names are trustworthy on text recovered from a blind spot.
  // NER on that text fabricates people out of noise: it turned a photo into
  // PERSON_NAME "Tey" and the button caption "Sign in" into PERSON_NAME "Sign",
  // putting fake values in the mapping table. A blind spot that does not
  // validate still gets masked; it just does not claim a value it cannot back.
  return null;
}

/**
 * Which boxes get the scoped second-pass OCR: blind spots (text-likelihood boxes
 * no OCR word overlaps, merged per line) and regularly grouped digit runs that
 * fail their checksum. The latter may be a misread real card/Aadhaar (a wrong
 * digit keeps the grouping), which the rescue verifies at other scales; a run
 * that stays invalid is left alone. Shared by the extension and the harness so
 * both queue the same boxes.
 */
export function planRescueBoxes(
  words: { text: string; bbox: BBox }[],
  textLikelihoodBoxes: BBox[],
): BBox[] {
  const blindSpots = residualBlindSpots(textLikelihoodBoxes, words);
  const unverified = findRegularNumericRuns(words)
    .filter((r) => findStructuredPii(r.text).length === 0)
    .map((r) => r.box);
  return [...mergeRowBoxes(blindSpots), ...unverified];
}

export interface RescueIo {
  /** Environment-specific: sharp in the eval harness, canvas in the browser. */
  encode: (crop: RawImage) => Promise<string>;
  ocr: (dataUrl: string) => Promise<{ joined: string }>;
}

/**
 * Tries each candidate crop config in order and keeps the FIRST one whose
 * rescued text actually validates (extractRescuedPii returns non-null) —
 * never the first one Tesseract merely produces SOME text for, which is
 * exactly what let a wrong single-guess factor silently return a
 * misread value in an earlier version of this function. A candidate that
 * reads garbage costs one wasted OCR call and is otherwise harmless: it
 * can never be MISTAKEN for a validated hit, so trying more candidates
 * only ever improves recall, never lowers precision.
 */
export async function rescueBlindSpot(
  img: RawImage,
  box: BBox,
  io: RescueIo,
  candidates: RescueCropOptions[] = RESCUE_CANDIDATES,
): Promise<{ bbox: BBox; category: PiiCategory; value: string } | null> {
  for (const opts of candidates) {
    const crop = prepareRescueCrop(img, box, opts);
    const dataUrl = await io.encode(crop);
    const ocr = await io.ocr(dataUrl);
    const hit = extractRescuedPii(ocr.joined);
    if (hit) return { bbox: box, category: hit.category, value: hit.value };
  }
  return null;
}
