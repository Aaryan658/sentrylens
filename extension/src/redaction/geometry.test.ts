import { describe, it, expect } from "vitest";
import { mergeRowBoxes } from "./geometry.js";

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
