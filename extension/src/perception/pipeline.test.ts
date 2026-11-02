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

  it("scrubs PII out of DOM element names, which travel to the server in the manifest as plain text", () => {
    const result = assemblePerception({
      task: "t",
      image: { w: 400, h: 300, dpr: 1 },
      domRegions: [
        { id: 1, bbox: [0, 0, 120, 20], source: "dom", role: "link", name: "Signed in as john.doe@mail.com", interactable: true },
        { id: 2, bbox: [0, 30, 120, 20], source: "dom", role: "link", name: "Call 9000000000", interactable: true },
        { id: 3, bbox: [0, 60, 120, 20], source: "dom", role: "button", name: "Open VSSC-03 report", interactable: true },
      ],
      domSensitive: [],
      faces: [],
      ocrWords: [],
      ocrJoined: "",
      ocrOffsets: [],
      nerSpans: [],
      degraded: false,
    });
    const json = JSON.stringify(result.manifest);
    expect(json).not.toContain("john.doe@mail.com");
    expect(json).not.toContain("9000000000");
    const text = (id: number) => (result.manifest.regions.find((r) => r.kind === "element" && r.id === id) as any).text as string;
    expect(text(3)).toBe("Open VSSC-03 report"); // ordinary names are untouched
    // the agent can still refer to the redacted value, and the client resolves it locally
    const ph = result.mapping.placeholderFor("EMAIL", "john.doe@mail.com");
    expect(text(1)).toBe(`Signed in as ${ph}`);
    expect(result.mapping.resolve(ph)).toBe("john.doe@mail.com");
  });

  it("labels a blind-spot mask inside a control with that control's clean DOM name (white-on-blue caption OCR cannot read)", () => {
    const base = {
      task: "t", image: { w: 400, h: 300, dpr: 1 }, domSensitive: [], faces: [], ocrWords: [], ocrJoined: "", ocrOffsets: [], nerSpans: [], degraded: false,
      textLikelihoodBoxes: [[330, 242, 44, 17]] as [number, number, number, number][],
    };
    const withName = (name: string) => assemblePerception({
      ...base,
      domRegions: [{ id: 1, bbox: [319, 233, 69, 32], source: "dom", role: "button", name, interactable: true }],
    });
    const region = (r: ReturnType<typeof withName>) => r.manifest.regions.find((x) => x.kind === "redacted") as any;
    expect(region(withName("Sign in")).caption).toBe("Sign in");
    // a name that itself contains PII must never be echoed onto the mask
    expect(region(withName("Call 9000000000")).caption).toBeUndefined();
    // and a blind spot outside every control gets no caption
    const outside = assemblePerception({ ...base, domRegions: [{ id: 1, bbox: [0, 0, 50, 20], source: "dom", role: "button", name: "Sign in", interactable: true }] });
    expect(region(outside).caption).toBeUndefined();
  });

  it("keeps face boxes in image pixels but scales DOM boxes by dpr (MediaPipe reports bitmap px)", () => {
    const dpr = 1.5;
    const result = assemblePerception({
      task: "t",
      image: { w: 300, h: 300, dpr },
      domRegions: [],
      // CSS px: must be scaled to image px
      domSensitive: [{ bbox: [10, 100, 80, 16], category: "PASSWORD" }],
      // already image px, exactly as runFaces returns them: must NOT be scaled again
      faces: [[120, 30, 60, 60]],
      ocrWords: [],
      ocrJoined: "",
      ocrOffsets: [],
      nerSpans: [],
      degraded: false,
    });
    const box = (cat: string) => (result.manifest.regions.find((r) => r.kind === "redacted" && r.category === cat) as any).bbox;
    expect(box("FACE")).toEqual([120, 30, 60, 60]);
    expect(box("PASSWORD")).toEqual([15, 150, 120, 24]);
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
