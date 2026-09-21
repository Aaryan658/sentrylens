import { describe, it, expect } from "vitest";
import { planMasks, planLabelDraw, MASK_PAD } from "./mask.js";
import type { RedactedRegion } from "@sentrylens/shared";

const region = (over: Partial<RedactedRegion> = {}): RedactedRegion => ({
  id: 10_000, bbox: [10, 20, 80, 16], kind: "redacted", category: "EMAIL",
  placeholder: "EMAIL#abc12", value_len: 12, risk: "medium", style: "blackbox",
  task_necessary: false, detected_by: ["regex"], ...over,
});

describe("planMasks", () => {
  it("emits exactly one op per redacted region, each covering its whole bbox", () => {
    const regions = [region(), region({ id: 10_001, bbox: [0, 0, 5, 5] })];
    const ops = planMasks(regions);
    expect(ops).toHaveLength(2);
    ops.forEach((op, i) => {
      const [rx, ry, rw, rh] = regions[i]!.bbox;
      const [ox, oy, ow, oh] = op.bbox;
      expect(ox).toBeLessThanOrEqual(rx);
      expect(oy).toBeLessThanOrEqual(ry);
      expect(ox + ow).toBeGreaterThanOrEqual(rx + rw);
      expect(oy + oh).toBeGreaterThanOrEqual(ry + rh);
    });
  });

  it("pads each mask by MASK_PAD px so glyph edges outside a tight OCR box do not show", () => {
    expect(planMasks([region()])[0]!.bbox).toEqual([10 - MASK_PAD, 20 - MASK_PAD, 80 + 2 * MASK_PAD, 16 + 2 * MASK_PAD]);
  });

  it("never pads a mask off the top or left edge of the image", () => {
    const [x, y, w, h] = planMasks([region({ bbox: [1, 0, 20, 10] })])[0]!.bbox;
    expect(x).toBe(0);
    expect(y).toBe(0);
    // still covers the original right/bottom edges
    expect(x + w).toBeGreaterThanOrEqual(21);
    expect(y + h).toBeGreaterThanOrEqual(10);
  });

  it("blackbox -> solid fill, pixelate/blur -> pixelate fill", () => {
    expect(planMasks([region({ style: "blackbox" })])[0]!.fill).toBe("solid");
    expect(planMasks([region({ style: "pixelate" })])[0]!.fill).toBe("pixelate");
    expect(planMasks([region({ style: "blur" })])[0]!.fill).toBe("pixelate");
  });

  it("blur uses a finer block than pixelate", () => {
    expect(planMasks([region({ style: "blur" })])[0]!.block).toBe(8);
    expect(planMasks([region({ style: "pixelate" })])[0]!.block).toBe(12);
  });

  it("carries the placeholder as the label, never a raw value", () => {
    const op = planMasks([region({ placeholder: "AADHAAR#z9y8x" })])[0]!;
    expect(op.label).toBe("AADHAAR#z9y8x");
  });

  it("draws only one label where two masks' labels would collide (a DOM cell box around an OCR name box garbled both)", () => {
    const ops = planMasks([
      region({ id: 1, bbox: [293, 407, 430, 36], placeholder: "PERSON_NAME#1", category: "PERSON_NAME" }), // big DOM cell
      region({ id: 2, bbox: [301, 421, 61, 11], placeholder: "PERSON_NAME#pq33z", category: "PERSON_NAME" }), // name inside it
    ]);
    const draw = planLabelDraw(ops);
    expect(draw.filter(Boolean)).toHaveLength(1);
    // the smaller, more specific mask keeps its label
    expect(draw[1]).toBe(true);
    expect(draw[0]).toBe(false);
  });

  it("draws every label when they do not collide", () => {
    const ops = planMasks([
      region({ id: 1, bbox: [10, 10, 100, 16], placeholder: "EMAIL#aaaaa" }),
      region({ id: 2, bbox: [10, 60, 100, 16], placeholder: "PHONE_NUMBER#bbbbb" }),
    ]);
    expect(planLabelDraw(ops)).toEqual([true, true]);
  });

  it("an empty region list plans nothing", () => {
    expect(planMasks([])).toEqual([]);
  });
});
