import { describe, it, expect } from "vitest";
import { assemblePerception } from "./pipeline.js";

describe("assemblePerception", () => {
  it("wires DOM/vision/OCR/NER into a classified manifest without leaking values", () => {
    const result = assemblePerception({
      task: "open the report",
      image: { w: 200, h: 200, dpr: 1 },
      domRegions: [{ id: 1, bbox: [0, 0, 50, 20], source: "dom", role: "button", name: "Open report", interactable: true }],
      domSensitive: [{ bbox: [0, 100, 80, 16], category: "PASSWORD" }],
      faces: [[120, 10, 40, 40]],
      ocrWords: [{ text: "ops@vssc.test", bbox: [0, 40, 100, 14] }],
      ocrJoined: "ops@vssc.test",
      ocrOffsets: [0],
      nerSpans: [],
      degraded: false,
    });
    const cats = result.classified.map((r) => r.category).sort();
    expect(cats).toEqual(["EMAIL", "FACE", "PASSWORD"]);
    expect(result.manifest.regions.some((r) => r.kind === "element")).toBe(true);
    expect(JSON.stringify(result.manifest)).not.toContain("ops@vssc.test");
    const emailRegion = result.manifest.regions.find((r) => r.kind === "redacted" && r.category === "EMAIL") as any;
    expect(result.mapping.resolve(emailRegion.placeholder)).toBe("ops@vssc.test");
  });

  it("passes detectorBoxes through to fusion as BYSTANDER_SCREEN", () => {
    const result = assemblePerception({
      task: "open the report",
      image: { w: 200, h: 200, dpr: 1 },
      domRegions: [],
      domSensitive: [],
      faces: [],
      ocrWords: [],
      ocrJoined: "",
      ocrOffsets: [],
      nerSpans: [],
      degraded: false,
      detectorBoxes: [{ label: "laptop", bbox: [10, 10, 50, 40], score: 0.9 }],
    });
    const cats = result.classified.map((r) => r.category);
    expect(cats).toEqual(["BYSTANDER_SCREEN"]);
  });
});
