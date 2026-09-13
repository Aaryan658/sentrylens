import { describe, it, expect } from "vitest";
import { fuseRegions } from "./fuse.js";
import { classify } from "./classify.js";
import type { PerceptionInputs } from "./types.js";

const empty: PerceptionInputs = {
  regions: [], domSensitive: [], faces: [], ocrWords: [], nerSpans: [],
  ocrJoined: "", ocrOffsets: [], pageSensitive: false,
};

describe("fuseRegions", () => {
  it("keeps a DOM password and an NER name and a face as three regions", () => {
    const inp: PerceptionInputs = {
      ...empty,
      domSensitive: [{ bbox: [10, 10, 100, 20], category: "PASSWORD", value: null, confidence: 1, detected_by: ["dom"] }],
      faces: [[300, 40, 60, 60]],
      ocrWords: [{ text: "Anita", bbox: [10, 80, 40, 16] }, { text: "Rao", bbox: [52, 80, 30, 16] }],
      ocrJoined: "Anita Rao",
      ocrOffsets: [0, 6],
      nerSpans: [{ category: "PERSON_NAME", value: "Anita Rao", start: 0, end: 9 }],
    };
    const out = fuseRegions(inp);
    const cats = out.map((r) => r.category).sort();
    expect(cats).toEqual(["FACE", "PASSWORD", "PERSON_NAME"]);
    const name = out.find((r) => r.category === "PERSON_NAME")!;
    expect(name.bbox).toEqual([10, 80, 72, 16]); // union of the two words
  });

  it("dedupes an NER hit and a regex hit on the same email (IoU>0.6) into one region with both sources", () => {
    const inp: PerceptionInputs = {
      ...empty,
      ocrWords: [{ text: "ops@vssc.test", bbox: [10, 10, 120, 16] }],
      ocrJoined: "ops@vssc.test",
      ocrOffsets: [0],
      nerSpans: [{ category: "EMAIL", value: "ops@vssc.test", start: 0, end: 13 }],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("EMAIL");
    expect(out[0]!.detected_by.sort()).toEqual(["ocr+ner", "regex"]);
  });

  it("promotes a face to high confidence when the page is sensitive", () => {
    const out = fuseRegions({ ...empty, faces: [[0, 0, 10, 10]], pageSensitive: true });
    expect(out[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("redacts a detected cell phone / laptop / tv as BYSTANDER_SCREEN", () => {
    const inp: PerceptionInputs = {
      ...empty,
      detectorBoxes: [
        { label: "cell phone", bbox: [400, 40, 60, 100], score: 0.8 },
        { label: "laptop", bbox: [10, 200, 120, 80], score: 0.7 },
        { label: "chair", bbox: [0, 0, 20, 20], score: 0.9 }, // irrelevant label, ignored
      ],
    };
    const out = fuseRegions(inp);
    const bystander = out.filter((r) => r.category === "BYSTANDER_SCREEN");
    expect(bystander).toHaveLength(2);
    expect(bystander.every((r) => r.detected_by.includes("detector"))).toBe(true);
  });

  it("drops a low-confidence detector box", () => {
    const inp: PerceptionInputs = {
      ...empty,
      detectorBoxes: [{ label: "cell phone", bbox: [0, 0, 10, 10], score: 0.4 }],
    };
    expect(fuseRegions(inp).filter((r) => r.category === "BYSTANDER_SCREEN")).toHaveLength(0);
  });

  it("uses a detected person as a fallback FACE region only when MediaPipe found none", () => {
    const withFallback = fuseRegions({
      ...empty,
      faces: [],
      detectorBoxes: [{ label: "person", bbox: [50, 50, 80, 120], score: 0.7 }],
    });
    expect(withFallback.filter((r) => r.category === "FACE")).toHaveLength(1);
    expect(withFallback[0]!.detected_by).toEqual(["detector"]);

    const withoutFallback = fuseRegions({
      ...empty,
      faces: [[50, 50, 40, 40]],
      detectorBoxes: [{ label: "person", bbox: [50, 50, 80, 120], score: 0.7 }],
    });
    // one real MediaPipe face, no extra region from the redundant person box
    expect(withoutFallback.filter((r) => r.category === "FACE")).toHaveLength(1);
    expect(withoutFallback[0]!.detected_by).toEqual(["face"]);
  });

  it("ignores a person box when no faces and no detector boxes are given (default empty array)", () => {
    expect(fuseRegions(empty).filter((r) => r.category === "FACE")).toHaveLength(0);
  });
});

describe("classify", () => {
  it("marks PASSWORD as high risk regardless of task", () => {
    const r = classify({ bbox: [0, 0, 1, 1], category: "PASSWORD", value: null, confidence: 1, detected_by: ["dom"] }, "browse news", []);
    expect(r.risk).toBe("high");
  });

  it("sets task_necessary when the task text overlaps a nearby element name", () => {
    const r = classify(
      { bbox: [10, 10, 50, 10], category: "PHONE_NUMBER", value: "9000000000", confidence: 1, detected_by: ["regex"] },
      "call the duty officer",
      [{ id: 1, bbox: [10, 8, 60, 14], source: "dom", role: "textbox", name: "duty officer phone", interactable: true }],
    );
    expect(r.task_necessary).toBe(true);
  });
});
