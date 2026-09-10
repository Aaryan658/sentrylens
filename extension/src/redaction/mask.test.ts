import { describe, it, expect } from "vitest";
import { planMasks } from "./mask.js";
import type { RedactedRegion } from "@sentrylens/shared";

const region = (over: Partial<RedactedRegion> = {}): RedactedRegion => ({
  id: 10_000, bbox: [10, 20, 80, 16], kind: "redacted", category: "EMAIL",
  placeholder: "EMAIL#abc12", value_len: 12, risk: "medium", style: "blackbox",
  task_necessary: false, detected_by: ["regex"], ...over,
});

describe("planMasks", () => {
  it("emits exactly one covering op per redacted region", () => {
    const ops = planMasks([region(), region({ id: 10_001, bbox: [0, 0, 5, 5] })]);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.bbox).toEqual([10, 20, 80, 16]);
    expect(ops[1]!.bbox).toEqual([0, 0, 5, 5]);
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

  it("an empty region list plans nothing", () => {
    expect(planMasks([])).toEqual([]);
  });
});
