import { describe, it, expect } from "vitest";
import { prepareRescueCrop, extractRescuedPii, rescueBlindSpot, planRescueBoxes, type RescueCropOptions } from "./ocr-rescue.js";
import type { RawImage } from "./text-likelihood.js";

function uniformImage(width: number, height: number, gray: number): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { data, width, height, channels: 4 };
}

function paintPatch(img: RawImage, patch: { x: number; y: number; w: number; h: number; lo: number; hi: number }): void {
  const { data, width } = img;
  for (let y = patch.y; y < patch.y + patch.h; y++) {
    for (let x = patch.x; x < patch.x + patch.w; x++) {
      const i = (y * width + x) * 4;
      const v = (x + y) % 2 === 0 ? patch.lo : patch.hi;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
}

describe("prepareRescueCrop", () => {
  it("crops the requested box plus padding, clamped to image bounds", () => {
    const img = uniformImage(100, 100, 255);
    const out = prepareRescueCrop(img, [40, 40, 10, 10], { padding: 5, upscale: 1 });
    // 10+5+5 = 20 on each axis, nothing clamped since far from edges
    expect(out.width).toBe(20);
    expect(out.height).toBe(20);
  });

  it("clamps padding at the image edge instead of reading out of bounds", () => {
    const img = uniformImage(100, 100, 255);
    const out = prepareRescueCrop(img, [0, 0, 10, 10], { padding: 5, upscale: 1 });
    // left/top padding clamped to 0, so width/height = 10 (box) + 5 (right/bottom only)
    expect(out.width).toBe(15);
    expect(out.height).toBe(15);
  });

  it("upscales the crop by the given integer factor", () => {
    const img = uniformImage(40, 40, 255);
    const out = prepareRescueCrop(img, [10, 10, 10, 10], { padding: 0, upscale: 3 });
    expect(out.width).toBe(30);
    expect(out.height).toBe(30);
  });

  it("upscales via bilinear interpolation, not blocky nearest-neighbor replication", () => {
    // A hard 0/255 edge at x=1: nearest-neighbor upscaling only ever
    // reproduces the two source values verbatim, never anything between
    // them. Bilinear blends across the seam, which is what let a real
    // tiny-font (8px) crop resolve "PAN BNZAA2318K" correctly instead of
    // misreading the blocky edges as "PAM BMZALZE18K" (see docs/EVAL_RESULTS.md).
    const img = uniformImage(4, 4, 0);
    for (let y = 0; y < 4; y++) {
      for (let x = 2; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      }
    }
    const out = prepareRescueCrop(img, [0, 0, 4, 4], { padding: 0, upscale: 8 });
    const midRowValues = new Set<number>();
    for (let x = 0; x < out.width; x++) {
      midRowValues.add(out.data[(16 * out.width + x) * 4]!);
    }
    const hasIntermediateValue = [...midRowValues].some((v) => v > 5 && v < 250);
    expect(hasIntermediateValue).toBe(true);
  });

  it("stretches a near-invisible low-contrast patch to the full 0-255 range", () => {
    const img = uniformImage(64, 40, 255);
    paintPatch(img, { x: 10, y: 10, w: 20, h: 12, lo: 242, hi: 248 });
    const out = prepareRescueCrop(img, [10, 10, 20, 12], { padding: 0, upscale: 1 });
    let min = 255, max = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      min = Math.min(min, out.data[i]!);
      max = Math.max(max, out.data[i]!);
    }
    expect(min).toBeLessThan(30);
    expect(max).toBeGreaterThan(225);
  });

  it("does not divide by zero on a perfectly flat crop (no contrast to stretch)", () => {
    const img = uniformImage(20, 20, 128);
    const out = prepareRescueCrop(img, [5, 5, 5, 5], { padding: 0, upscale: 1 });
    expect(Array.from(out.data).every((v, i) => (i % 4 === 3 ? v === 255 : Number.isFinite(v)))).toBe(true);
  });

  it("returns a degenerate 1x1 crop instead of throwing when the box has zero size", () => {
    const img = uniformImage(20, 20, 128);
    expect(() => prepareRescueCrop(img, [5, 5, 0, 0], { padding: 0, upscale: 1 })).not.toThrow();
  });
});

describe("extractRescuedPii", () => {
  it("prefers a structured-regex hit (e.g. a valid Aadhaar number) from the crop's OCR text", () => {
    const hit = extractRescuedPii("2341 2341 2346");
    expect(hit).toEqual({ category: "AADHAAR", value: "2341 2341 2346" });
  });

  it("accepts a labeled name (needs a real label word, which noise does not produce)", () => {
    const hit = extractRescuedPii("Operator R. Iyer");
    expect(hit).toEqual({ category: "PERSON_NAME", value: "R. Iyer" });
  });

  it("does NOT turn unlabeled words into a person (NER on recovered noise fabricated 'Tey' from a photo and 'Sign' from a button)", () => {
    expect(extractRescuedPii("Tey")).toBeNull();
    expect(extractRescuedPii("Sign in")).toBeNull();
    expect(extractRescuedPii("Anita Rao")).toBeNull();
  });

  it("returns null when the rescued text matches no known PII shape (must not guess)", () => {
    expect(extractRescuedPii("just some random label text")).toBeNull();
  });

  it("returns null for empty rescued text", () => {
    expect(extractRescuedPii("")).toBeNull();
  });
});

describe("planRescueBoxes", () => {
  const w = (text: string, x: number, y = 100) => ({ text, bbox: [x, y, 32, 12] as [number, number, number, number] });

  it("includes merged blind spots (text-like boxes no OCR word overlaps)", () => {
    const boxes = planRescueBoxes([w("hello", 10)], [[10, 100, 32, 12], [200, 100, 20, 12], [224, 100, 20, 12]]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]![0]).toBe(200);
  });

  it("also queues a regular digit run that FAILS its checksum, so a misread real card gets a second look", () => {
    const words = [w("4111", 10), w("1111", 50), w("1111", 90), w("1112", 130)];
    expect(planRescueBoxes(words, [])).toHaveLength(1);
  });

  it("does not re-read a run that already validates", () => {
    const words = [w("4111", 10), w("1111", 50), w("1111", 90), w("1111", 130)];
    expect(planRescueBoxes(words, [])).toEqual([]);
  });
});

describe("rescueBlindSpot", () => {
  const img: RawImage = { data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40, channels: 4 };
  const box: [number, number, number, number] = [5, 5, 10, 10];
  const candidates: RescueCropOptions[] = [{ upscale: 5 }, { upscale: 3 }, { upscale: 8 }];

  function makeIo(joinedByAttempt: string[]) {
    let attempt = 0;
    const encodeCalls: unknown[] = [];
    return {
      io: {
        encode: async (crop: RawImage) => { encodeCalls.push(crop); return `data:fake/${attempt}`; },
        ocr: async () => ({ joined: joinedByAttempt[attempt++] ?? "" }),
      },
      encodeCalls,
    };
  }

  it("returns the first candidate's hit when it validates, without trying later candidates", async () => {
    const { io, encodeCalls } = makeIo(["2341 2341 2346"]);
    const hit = await rescueBlindSpot(img, box, io, candidates);
    expect(hit).toEqual({ bbox: box, category: "AADHAAR", value: "2341 2341 2346" });
    expect(encodeCalls).toHaveLength(1);
  });

  it("falls through to the next candidate when an earlier one doesn't validate", async () => {
    const { io, encodeCalls } = makeIo(["garbled nonsense", "BNZAA2318K"]);
    const hit = await rescueBlindSpot(img, box, io, candidates);
    expect(hit).toEqual({ bbox: box, category: "PAN", value: "BNZAA2318K" });
    expect(encodeCalls).toHaveLength(2);
  });

  it("returns null when no candidate validates (must not guess)", async () => {
    const { io, encodeCalls } = makeIo(["nope", "still nothing", "garbage text"]);
    const hit = await rescueBlindSpot(img, box, io, candidates);
    expect(hit).toBeNull();
    expect(encodeCalls).toHaveLength(3);
  });
});
