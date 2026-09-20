import type { BBox } from "@sentrylens/shared";

/**
 * Detects "something text-like is here" independently of whether Tesseract
 * can actually READ it — a different, easier problem than OCR itself.
 * Text (of any size or contrast) has measurably higher LOCAL pixel
 * variance than flat background, because anti-aliased glyph edges create
 * local structure even when the absolute contrast is tiny (near-white-on-
 * white) or the glyphs are only a few pixels tall. This is a relative,
 * not absolute, signal, so it survives both adversarial cases that defeat
 * Tesseract's own (effectively global) binarization: near-invisible
 * contrast and sub-10px fonts.
 *
 * Used as a REGION-PROPOSAL step only. Callers must intersect the returned
 * boxes against real OCR word boxes and only act on the ones with no
 * overlap — this function has no notion of "already read fine", so if a
 * caller redacted every box this returns, it would flag ordinary legible
 * text too (which also has high local variance). See fuse.ts's use: it
 * only turns a candidate into a redacted region when OCR found nothing
 * there, i.e. this proposes OCR *blind spots*, not PII by itself.
 */
export interface RawImage {
  data: Uint8ClampedArray | Buffer;
  width: number;
  height: number;
  channels: number; // 3 (RGB) or 4 (RGBA) — only the first 3 are read
}

export interface TextLikelihoodOptions {
  /** Local window side length (px) used to compute local stddev. */
  window?: number;
  /** Local stddev at/above this is flagged as "structured", not flat background. */
  stddevThreshold?: number;
  /** Reject connected blobs smaller than this many flagged pixels (denoise). */
  minBlobPixels?: number;
  /** A blob thinner than this (px) AND elongated (see minLineAspect) is a line, not text. */
  minSide?: number;
  /** Long:short ratio above which a thin blob counts as a line. */
  minLineAspect?: number;
  /** Border width (px) ignored when testing whether a blob is a hollow outline. */
  hollowInset?: number;
  /** A large blob whose interior is filled less than this fraction is a hollow outline. */
  hollowInteriorFill?: number;
  /** Blobs smaller than this bbox area (px^2) are never judged hollow. */
  minHollowArea?: number;
}

// minBlobPixels=40: with window=5 (radius 2), even a single stray pixel
// (PNG noise, a rendering artifact) flags a ~25px neighborhood around it —
// so the threshold must clear that floor to actually denoise, while still
// catching real text patches (which span far more pixels than one glyph's
// worth of anti-aliasing noise).
const DEFAULTS: Required<TextLikelihoodOptions> = {
  window: 5,
  stddevThreshold: 3,
  minBlobPixels: 40,
  // Measured on eval/fixtures.ts (see docs/EVAL_RESULTS.md): text blobs have
  // interior fill 0.57-1.00, outlines 0.00-0.19, so 0.35 splits them with
  // margin on both sides. Lines from 1px borders come out 4-5px thick.
  minSide: 6,
  minLineAspect: 6,
  hollowInset: 6,
  hollowInteriorFill: 0.35,
  minHollowArea: 2000,
};

/** A connected high-variance blob plus the shape metrics used to tell text from page chrome. */
export interface TextLikelihoodBlob {
  box: BBox;
  /** flagged pixels belonging to this blob */
  pixels: number;
  /** flagged pixels of this blob that lie inside its bbox inset by `hollowInset` */
  interiorPixels: number;
}

export function textLikelihoodRegions(img: RawImage, opts: TextLikelihoodOptions = {}): BBox[] {
  const o = { ...DEFAULTS, ...opts };
  return textLikelihoodBlobs(img, opts)
    .filter((b) => !isChrome(b, o))
    .map((b) => b.box);
}

/**
 * Page chrome, not text: things with high local variance (an edge, a border)
 * that are not glyphs. A blob is dropped only when it is positively
 * identifiable as one of these; anything ambiguous stays proposed, because
 * this backstop exists to fail closed.
 *  - thin: a line (header edge, divider, underline), never a text line.
 *  - hollow: an outline (input border, card border, table grid). Its flagged
 *    pixels hug the perimeter and its interior is empty. Text INSIDE an
 *    outline is a separate blob and is judged on its own, so dropping the
 *    outline never hides the text in it.
 */
function isChrome(b: TextLikelihoodBlob, o: Required<TextLikelihoodOptions>): boolean {
  const [, , w, h] = b.box;
  const short = Math.min(w, h);
  // Aspect alone is NOT a signal: one long line of ordinary text can be
  // 480x14 (aspect 34). Only a blob that is both very thin and elongated is a line.
  if (short < o.minSide && Math.max(w, h) / short > o.minLineAspect) return true;
  // Small boxes are ambiguous (a checkbox, an icon button, a short label);
  // keep them, fail closed. Only large blobs are judged hollow.
  if (w * h < o.minHollowArea) return false;
  const iw = w - 2 * o.hollowInset;
  const ih = h - 2 * o.hollowInset;
  if (iw < 4 || ih < 4) return false;
  return b.interiorPixels / (iw * ih) < o.hollowInteriorFill;
}

export function textLikelihoodBlobs(img: RawImage, opts: TextLikelihoodOptions = {}): TextLikelihoodBlob[] {
  const { window, stddevThreshold, minBlobPixels, hollowInset } = { ...DEFAULTS, ...opts };
  const { width, height } = img;
  if (width < 2 || height < 2) return [];

  const gray = toGrayscale(img);
  const sum = buildIntegral(gray, width, height);
  const sq = new Float64Array(gray.length);
  for (let i = 0; i < gray.length; i++) sq[i] = gray[i]! * gray[i]!;
  const sumSq = buildIntegral(sq, width, height);

  const r = window >> 1;
  const flagged = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = boxSum(sum, width, x0, y0, x1, y1);
      const s2 = boxSum(sumSq, width, x0, y0, x1, y1);
      const mean = s / n;
      const variance = Math.max(0, s2 / n - mean * mean);
      if (Math.sqrt(variance) >= stddevThreshold) flagged[y * width + x] = 1;
    }
  }

  return connectedComponents(flagged, width, height, minBlobPixels, hollowInset);
}

function toGrayscale(img: RawImage): Float64Array {
  const { data, width, height, channels } = img;
  const out = new Float64Array(width * height);
  for (let i = 0, p = 0; p < width * height; i += channels, p++) {
    out[p] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
  }
  return out;
}

// (w+1) x (h+1) summed-area table (row 0 / col 0 are the zero padding).
function buildIntegral(vals: Float64Array, w: number, h: number): Float64Array {
  const stride = w + 1;
  const s = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += vals[y * w + x]!;
      s[(y + 1) * stride + (x + 1)] = s[y * stride + (x + 1)]! + rowSum;
    }
  }
  return s;
}

function boxSum(integral: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const stride = w + 1;
  const a = integral[y0 * stride + x0]!;
  const b = integral[y0 * stride + (x1 + 1)]!;
  const c = integral[(y1 + 1) * stride + x0]!;
  const d = integral[(y1 + 1) * stride + (x1 + 1)]!;
  return d - b - c + a;
}

function connectedComponents(
  flagged: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
  inset: number,
): TextLikelihoodBlob[] {
  const visited = new Uint8Array(width * height);
  const blobs: TextLikelihoodBlob[] = [];
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < flagged.length; start++) {
    if (!flagged[start] || visited[start]) continue;
    stack.length = 0;
    members.length = 0;
    stack.push(start);
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = (idx / width) | 0;
      members.push(idx);
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && flagged[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; stack.push(idx - 1); }
      if (x < width - 1 && flagged[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && flagged[idx - width] && !visited[idx - width]) { visited[idx - width] = 1; stack.push(idx - width); }
      if (y < height - 1 && flagged[idx + width] && !visited[idx + width]) { visited[idx + width] = 1; stack.push(idx + width); }
    }
    if (count < minPixels) continue;
    let interior = 0;
    for (const idx of members) {
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x >= minX + inset && x <= maxX - inset && y >= minY + inset && y <= maxY - inset) interior++;
    }
    blobs.push({ box: [minX, minY, maxX - minX + 1, maxY - minY + 1], pixels: count, interiorPixels: interior });
  }
  return blobs;
}
