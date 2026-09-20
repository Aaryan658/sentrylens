import { describe, it, expect } from "vitest";
import sharp from "sharp";
import type { BBox } from "@sentrylens/shared";
import { textLikelihoodRegions, type RawImage } from "./text-likelihood.js";
import { DARK_UI_SVG, DARK_UI_TEXT_RECTS } from "../../eval/fixtures.js";

function uniformImage(width: number, height: number, gray: number): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { data, width, height, channels: 4 };
}

// Paints a checkerboard "textured" patch (alternating two close gray values,
// the way anti-aliased glyph edges look up close) into an otherwise-uniform
// image, simulating a text-like region without needing real font rendering.
function withTexturedPatch(
  width: number,
  height: number,
  bg: number,
  patch: { x: number; y: number; w: number; h: number; lo: number; hi: number },
): RawImage {
  const img = uniformImage(width, height, bg);
  const { data } = img;
  for (let y = patch.y; y < patch.y + patch.h; y++) {
    for (let x = patch.x; x < patch.x + patch.w; x++) {
      const i = (y * width + x) * 4;
      const v = (x + y) % 2 === 0 ? patch.lo : patch.hi;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  return img;
}

describe("textLikelihoodRegions", () => {
  it("flags nothing in a perfectly uniform image", () => {
    const img = uniformImage(64, 40, 255);
    expect(textLikelihoodRegions(img)).toEqual([]);
  });

  it("flags a normal-contrast textured patch (simulated legible text)", () => {
    const img = withTexturedPatch(64, 40, 255, { x: 10, y: 10, w: 20, h: 12, lo: 20, hi: 235 });
    const boxes = textLikelihoodRegions(img);
    expect(boxes.length).toBeGreaterThan(0);
    const [bx, by, bw, bh] = boxes[0]!;
    // bbox should land inside/around the patch, not spuriously elsewhere
    expect(bx).toBeGreaterThanOrEqual(5);
    expect(by).toBeGreaterThanOrEqual(5);
    expect(bx + bw).toBeLessThanOrEqual(35);
    expect(by + bh).toBeLessThanOrEqual(27);
  });

  it("flags a NEAR-INVISIBLE low-contrast textured patch (the adversarial case)", () => {
    // 242 vs 248 on a 255 background: ~2.4-4.6% contrast — well below what
    // a human would notice at a glance or a global-threshold binarizer
    // would separate from paper-white, but still a real local variance.
    const img = withTexturedPatch(64, 40, 255, { x: 10, y: 10, w: 20, h: 12, lo: 242, hi: 248 });
    const boxes = textLikelihoodRegions(img);
    expect(boxes.length).toBeGreaterThan(0);
  });

  it("does not flag a tiny handful of noise pixels (denoise via minBlobPixels)", () => {
    const img = uniformImage(64, 40, 255);
    // 3 isolated single-pixel outliers - should be rejected as noise
    for (const [x, y] of [[5, 5], [30, 20], [50, 35]] as const) {
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    }
    expect(textLikelihoodRegions(img)).toEqual([]);
  });

  it("returns [] for a degenerate 1x1 image instead of throwing", () => {
    expect(textLikelihoodRegions(uniformImage(1, 1, 128))).toEqual([]);
  });
});

describe("textLikelihoodRegions: page chrome vs text", () => {
  // Outline of a rectangle, `t` px thick, drawn with the same alternating
  // pattern as withTexturedPatch so it registers as high local variance.
  function withOutline(width: number, height: number, r: { x: number; y: number; w: number; h: number; t: number }): RawImage {
    const img = uniformImage(width, height, 255);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const edge = x < r.x + r.t || x >= r.x + r.w - r.t || y < r.y + r.t || y >= r.y + r.h - r.t;
        if (!edge) continue;
        const i = (y * width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = (x + y) % 2 === 0 ? 20 : 235;
      }
    }
    return img;
  }

  it("drops a thin horizontal line (header edge, divider)", () => {
    const img = withTexturedPatch(300, 60, 255, { x: 0, y: 20, w: 300, h: 1, lo: 20, hi: 235 });
    expect(textLikelihoodRegions(img)).toEqual([]);
  });

  it("drops a large hollow outline (card / input border)", () => {
    expect(textLikelihoodRegions(withOutline(300, 140, { x: 10, y: 10, w: 280, h: 120, t: 1 }))).toEqual([]);
  });

  it("keeps a small hollow outline (checkbox-sized): ambiguous, so fail closed", () => {
    expect(textLikelihoodRegions(withOutline(80, 60, { x: 20, y: 20, w: 18, h: 18, t: 1 })).length).toBeGreaterThan(0);
  });

  it("keeps one long line of text-like texture even when its aspect ratio is extreme", () => {
    // 480x14 is aspect ~34: a plain aspect-ratio cutoff would wrongly call this a line.
    const img = withTexturedPatch(520, 40, 255, { x: 20, y: 12, w: 480, h: 14, lo: 20, hi: 235 });
    expect(textLikelihoodRegions(img).length).toBeGreaterThan(0);
  });
});

// Regression: the backstop is meant to propose OCR *blind spots that look like
// text*. On a realistic UI it must not also propose the header edge, input
// outlines, card borders or table grid, or the live extension black-boxes the
// page chrome (and the Sign-in button the agent needs). OCR is not in this
// loop, so every genuine text run is expected to be proposed; everything else
// is a stray.
describe("textLikelihoodRegions on a realistic dark UI (eval/fixtures DARK_UI_SVG)", () => {
  const PAD = 8;
  const intersects = (a: BBox, b: BBox) =>
    a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const grow = (r: BBox, p: number): BBox => [r[0] - p, r[1] - p, r[2] + 2 * p, r[3] + 2 * p];

  async function boxesForUi(): Promise<BBox[]> {
    const { data, info } = await sharp(Buffer.from(DARK_UI_SVG)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return textLikelihoodRegions({ data, width: info.width, height: info.height, channels: info.channels });
  }

  it("proposes no box that is not on real text (no lines, outlines or grids)", async () => {
    const boxes = await boxesForUi();
    const strays = boxes.filter((b) => {
      const near = DARK_UI_TEXT_RECTS.map((r) => grow(r, PAD)).filter((r) => intersects(r, b));
      // a text box may be a little bigger than our estimate of the text, but a
      // box several times larger than any text run it touches is chrome
      return near.length === 0 || b[2] * b[3] > 4 * Math.max(...near.map((r) => r[2] * r[3]));
    });
    expect(strays).toEqual([]);
  });

  it("still proposes every text run on that UI (nothing real is filtered out)", async () => {
    const boxes = await boxesForUi();
    const missed = DARK_UI_TEXT_RECTS.filter((r) => !boxes.some((b) => intersects(grow(r, PAD), b)));
    expect(missed).toEqual([]);
  });
});
