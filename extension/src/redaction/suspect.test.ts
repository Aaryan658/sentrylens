import { describe, it, expect } from "vitest";
import { findSuspectNumericRuns, findSuspectEmailFragments, findRegularNumericRuns } from "./suspect.js";
import type { BBox } from "@sentrylens/shared";

// Lays words out left to right on one row, 8px per char, 6px gaps, height 12.
function row(texts: string[], y = 100, x0 = 10): { text: string; bbox: BBox }[] {
  let x = x0;
  return texts.map((text) => {
    const w = text.length * 8;
    const out = { text, bbox: [x, y, w, 12] as BBox };
    x += w + 6;
    return out;
  });
}

describe("findSuspectNumericRuns (a misread identifier must not pass as ordinary text)", () => {
  it("flags the real Chrome misread of a card number: lookalike letter + irregular groups", () => {
    const words = row(["Payroll", "card", "A111", "1111111", "1111"]);
    const runs = findSuspectNumericRuns(words);
    expect(runs).toHaveLength(1);
    // covers exactly the three numeric words, not the label
    expect(runs[0]![0]).toBe(words[2]!.bbox[0]);
    expect(runs[0]![0] + runs[0]![2]).toBe(words[4]!.bbox[0] + words[4]!.bbox[2]);
  });

  it("flags digit-only misreads with irregular grouping (12 + 3, 8 + 4 + 4)", () => {
    expect(findSuspectNumericRuns(row(["411111111111", "111"]))).toHaveLength(1);
    expect(findSuspectNumericRuns(row(["43215678", "9003"]))).toHaveLength(1);
  });

  it("flags a single garbled token that is mostly lookalike letters ('gooooo0000' was a phone number)", () => {
    expect(findSuspectNumericRuns(row(["Call", "gooooo0000"]))).toHaveLength(1);
  });

  it("does not flag ordinary long words or real identifiers as single garbled tokens", () => {
    expect(findSuspectNumericRuns(row(["Google", "Operations", "Console"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["ABCDE1234F"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["9000000000"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["RPT-2026-0913"]))).toEqual([]);
  });

  it("leaves a clean, regularly grouped number alone (a deliberate invalid sample card is not a leak)", () => {
    expect(findSuspectNumericRuns(row(["4111", "1111", "1111", "1112"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["2341", "2341", "2346"]))).toEqual([]);
  });

  it("ignores ordinary numbers, ids and dates (too short or not digit-dominated)", () => {
    expect(findSuspectNumericRuns(row(["Rs", "12000", "pending"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["RPT-2026-0913"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["Last", "packet", "12:04:37", "IST"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["9000000000"]))).toEqual([]);
    expect(findSuspectNumericRuns(row(["Operator", "Aadhaar", "Payroll"]))).toEqual([]);
  });

  it("does not join numbers on different rows or far apart on one row", () => {
    const a = row(["411111111111"], 100);
    const b = row(["111"], 160);
    expect(findSuspectNumericRuns([...a, ...b])).toEqual([]);
    const far: { text: string; bbox: BBox }[] = [
      { text: "411111111111", bbox: [10, 100, 96, 12] },
      { text: "111", bbox: [400, 100, 24, 12] },
    ];
    expect(findSuspectNumericRuns(far)).toEqual([]);
  });
});

describe("findRegularNumericRuns (regularly grouped runs that need a checksum second look)", () => {
  it("returns a clean 4x4 / 4x3 digit run with its text so the caller can verify it", () => {
    const words = row(["Card", "4111", "1111", "1111", "1112"]);
    const runs = findRegularNumericRuns(words);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.text).toBe("4111 1111 1111 1112");
    expect(findRegularNumericRuns(row(["2341", "2341", "2346"]))[0]!.text).toBe("2341 2341 2346");
  });

  it("does not return misread-looking runs (those are masked outright) or short numbers", () => {
    expect(findRegularNumericRuns(row(["A111", "1111111", "1111"]))).toEqual([]);
    expect(findRegularNumericRuns(row(["411111111111", "111"]))).toEqual([]);
    expect(findRegularNumericRuns(row(["Rs", "1200", "0000"]))).toEqual([]);
  });
});

describe("findSuspectEmailFragments (an email whose dot OCR dropped)", () => {
  it("flags 'ops.lead@vssc test' and covers both halves", () => {
    const words = row(["Email", "ops.lead@vssc", "test", "PAN"]);
    const hits = findSuspectEmailFragments(words);
    expect(hits).toHaveLength(1);
    expect(hits[0]![0]).toBe(words[1]!.bbox[0]);
    expect(hits[0]![0] + hits[0]![2]).toBe(words[2]!.bbox[0] + words[2]!.bbox[2]);
  });

  it("flags a lone '@' fragment word", () => {
    expect(findSuspectEmailFragments(row(["mail", "a.b@vssc"]))).toHaveLength(1);
  });

  it("leaves a complete address to the normal detectors", () => {
    expect(findSuspectEmailFragments(row(["ops.lead@vssc.test"]))).toEqual([]);
  });

  it("ignores a bare '@' and words without one", () => {
    expect(findSuspectEmailFragments(row(["@", "handle"]))).toEqual([]);
    expect(findSuspectEmailFragments(row(["no", "at", "sign"]))).toEqual([]);
  });
});
