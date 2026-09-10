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
    expect(out[0].category).toBe("EMAIL");
    expect(out[0].detected_by.sort()).toEqual(["ocr+ner", "regex"]);
  });

  it("promotes a face to high confidence when the page is sensitive", () => {
    const out = fuseRegions({ ...empty, faces: [[0, 0, 10, 10]], pageSensitive: true });
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.9);
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
