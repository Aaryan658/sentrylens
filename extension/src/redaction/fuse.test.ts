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

  it("drops a fail-closed blind-spot box that lies entirely inside another redacted region (adds no coverage)", () => {
    const inp: PerceptionInputs = {
      ...empty,
      domSensitive: [{ bbox: [10, 10, 300, 40], category: "PASSWORD", value: null, confidence: 1, detected_by: ["dom"] }],
      textLikelihoodBoxes: [
        [60, 22, 200, 14], // the dots inside the password field, already fully masked
        [400, 22, 80, 14], // somewhere else: must still be redacted
      ],
    };
    const out = fuseRegions(inp);
    expect(out.map((r) => r.category).sort()).toEqual(["OTHER", "PASSWORD"]);
    expect(out.find((r) => r.category === "OTHER")!.bbox).toEqual([400, 22, 80, 14]);
  });

  it("fails closed on a MISREAD card number (real Chrome read 'A111 1111111 1111', which no validator accepts)", () => {
    const words = [
      { text: "Payroll", bbox: [10, 100, 56, 12] as [number, number, number, number] },
      { text: "card", bbox: [72, 100, 32, 12] as [number, number, number, number] },
      { text: "A111", bbox: [200, 100, 32, 12] as [number, number, number, number] },
      { text: "1111111", bbox: [238, 100, 56, 12] as [number, number, number, number] },
      { text: "1111", bbox: [300, 100, 32, 12] as [number, number, number, number] },
    ];
    const out = fuseRegions({ ...empty, ocrWords: words, ocrJoined: words.map((w) => w.text).join(" "), ocrOffsets: [0, 8, 13, 18, 26] });
    expect(out).toHaveLength(1);
    expect(out[0]!.detected_by).toEqual(["heuristic"]);
    expect(out[0]!.bbox).toEqual([200, 100, 132, 12]);
  });

  it("fails closed on an email whose dot OCR dropped ('ops.lead@vssc test')", () => {
    const words = [
      { text: "ops.lead@vssc", bbox: [100, 50, 104, 12] as [number, number, number, number] },
      { text: "test", bbox: [210, 50, 32, 12] as [number, number, number, number] },
    ];
    const out = fuseRegions({ ...empty, ocrWords: words, ocrJoined: "ops.lead@vssc test", ocrOffsets: [0, 14] });
    expect(out).toHaveLength(1);
    expect(out[0]!.category).toBe("EMAIL");
    expect(out[0]!.bbox).toEqual([100, 50, 142, 12]);
  });

  it("does not mask a clean, regularly grouped number that merely fails its checksum", () => {
    const words = ["4111", "1111", "1111", "1112"].map((text, i) => ({ text, bbox: [10 + i * 40, 20, 32, 12] as [number, number, number, number] }));
    const out = fuseRegions({ ...empty, ocrWords: words, ocrJoined: "4111 1111 1111 1112", ocrOffsets: [0, 5, 10, 15] });
    expect(out).toEqual([]);
  });

  it("drops a value fragment that sits inside a larger region already carrying the full value (NER tagged '41' inside a card number)", () => {
    const inp: PerceptionInputs = {
      ...empty,
      ocrWords: [{ text: "4111", bbox: [10, 10, 40, 14] }, { text: "1111", bbox: [56, 10, 40, 14] }, { text: "1111", bbox: [102, 10, 40, 14] }, { text: "1111", bbox: [148, 10, 40, 14] }],
      ocrJoined: "4111 1111 1111 1111",
      ocrOffsets: [0, 5, 10, 15],
      nerSpans: [{ category: "CREDIT_CARD", value: "41", start: 0, end: 2 }],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe("4111 1111 1111 1111");
  });

  it("keeps two DIFFERENT values that merely touch (a fragment rule must not swallow distinct items)", () => {
    const inp: PerceptionInputs = {
      ...empty,
      ocrWords: [{ text: "ops@vssc.test", bbox: [10, 10, 100, 14] }, { text: "9000000000", bbox: [10, 40, 80, 14] }],
      ocrJoined: "ops@vssc.test 9000000000",
      ocrOffsets: [0, 14],
    };
    expect(fuseRegions(inp).map((r) => r.category).sort()).toEqual(["EMAIL", "PHONE_NUMBER"]);
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

  it("infers a category for a heuristic OCR blind spot from a nearby legible label", () => {
    const inp: PerceptionInputs = {
      ...empty,
      ocrWords: [{ text: "Aadhaar:", bbox: [10, 40, 70, 20] }],
      textLikelihoodBoxes: [[100, 40, 150, 20]], // no OCR word overlaps this box
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: "AADHAAR", value: null, detected_by: ["heuristic"] });
  });

  it("falls back to OTHER for a heuristic blind spot with no nearby label", () => {
    const inp: PerceptionInputs = {
      ...empty,
      textLikelihoodBoxes: [[100, 40, 150, 20]],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: "OTHER", value: null, detected_by: ["heuristic"] });
  });

  it("merges a rescued value into a heuristic blind spot without dropping the fail-closed tag", () => {
    const inp: PerceptionInputs = {
      ...empty,
      textLikelihoodBoxes: [[100, 40, 150, 20]],
      rescuedRegions: [{ bbox: [100, 40, 150, 20], category: "AADHAAR", value: "2341 2341 2346" }],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    // Real category+value now available for the agent's task-necessity reasoning,
    // but "heuristic" must survive the merge — classify.ts keys its forced
    // high-risk/blackbox override off exactly that tag, not the category.
    expect(out[0]).toMatchObject({ category: "AADHAAR", value: "2341 2341 2346" });
    expect(out[0]!.detected_by).toContain("heuristic");
  });

  it("ignores a rescued region that doesn't correspond to any heuristic blind spot", () => {
    const inp: PerceptionInputs = {
      ...empty,
      rescuedRegions: [{ bbox: [100, 40, 150, 20], category: "AADHAAR", value: "2341 2341 2346" }],
    };
    const out = fuseRegions(inp);
    expect(out).toHaveLength(1);
    expect(out[0]!.detected_by).not.toContain("heuristic");
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
