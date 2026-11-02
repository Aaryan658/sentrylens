import { describe, it, expect } from "vitest";
import { mergeRowBoxes, residualBlindSpots } from "./geometry.js";

describe("residualBlindSpots (the unread part of a partly-read text blob)", () => {
  const word = (x: number, w: number, y = 100, h = 14) => ({ bbox: [x, y, w, h] as [number, number, number, number] });

  it("returns the whole box when no OCR word overlaps it", () => {
    expect(residualBlindSpots([[10, 100, 80, 14]], [word(300, 40)])).toEqual([[10, 100, 80, 14]]);
  });

  it("returns nothing when OCR words cover the blob (ordinary legible text)", () => {
    expect(residualBlindSpots([[10, 100, 120, 14]], [word(10, 50), word(66, 64)])).toEqual([]);
  });

  it("returns the unread VALUE when only the label was read: 'PAN' read, 'ABCDE1234F' dropped, one merged blob", () => {
    const out = residualBlindSpots([[10, 100, 150, 14]], [word(10, 28)]);
    expect(out).toEqual([[38, 100, 122, 14]]);
  });

  it("returns an unread stretch in the middle, and ignores gaps too small to hold a word", () => {
    // words at 10-40 and 100-140: a 60px hole between them; and a 6px word gap elsewhere
    expect(residualBlindSpots([[10, 100, 130, 14]], [word(10, 30), word(100, 40)])).toEqual([[40, 100, 60, 14]]);
    expect(residualBlindSpots([[10, 100, 76, 14]], [word(10, 34), word(50, 36)])).toEqual([]);
  });

  it("only counts words on the same line as the blob", () => {
    // a word in the row below overlaps horizontally but is not this blob's text
    expect(residualBlindSpots([[10, 100, 80, 14]], [word(10, 80, 130)])).toEqual([[10, 100, 80, 14]]);
  });
});

describe("mergeRowBoxes", () => {
  it("merges adjacent same-row fragments (small gaps) into one line box", () => {
    // Mirrors what text-likelihood.ts actually produces for a low-contrast
    // line: connected-components fragments it into several small blobs a
    // few px apart, not one unified line box (see docs/EVAL_RESULTS.md).
    const boxes: [number, number, number, number][] = [
      [23, 66, 95, 20], // "Aadhaar"
      [123, 66, 14, 20],
      [138, 66, 27, 20],
      [166, 66, 13, 20],
    ];
    const merged = mergeRowBoxes(boxes);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual([23, 66, 156, 20]);
  });

  it("does not merge boxes on the same row separated by a large gap (likely a different field)", () => {
    const boxes: [number, number, number, number][] = [
      [10, 10, 40, 20],
      [400, 10, 40, 20],
    ];
    expect(mergeRowBoxes(boxes)).toHaveLength(2);
  });

  it("does not merge boxes on different rows even if horizontally close", () => {
    const boxes: [number, number, number, number][] = [
      [10, 10, 40, 20],
      [15, 200, 40, 20],
    ];
    expect(mergeRowBoxes(boxes)).toHaveLength(2);
  });

  it("leaves a single box unchanged", () => {
    const boxes: [number, number, number, number][] = [[10, 10, 40, 20]];
    expect(mergeRowBoxes(boxes)).toEqual(boxes);
  });

  it("returns an empty array for empty input", () => {
    expect(mergeRowBoxes([])).toEqual([]);
  });
});
