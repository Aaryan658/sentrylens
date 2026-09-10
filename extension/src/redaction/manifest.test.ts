import { describe, it, expect } from "vitest";
import { buildManifest } from "./manifest.js";
import { MappingTable } from "./mapping.js";
import type { ClassifiedRegion } from "./classify.js";
import { RedactionManifestSchema } from "@sentrylens/shared";

const region = (over: Partial<ClassifiedRegion> = {}): ClassifiedRegion => ({
  bbox: [10, 10, 80, 16], category: "PHONE_NUMBER", value: "9000000000",
  confidence: 0.9, detected_by: ["regex"], risk: "medium", style: "blackbox",
  task_necessary: true, ...over,
});

describe("buildManifest", () => {
  it("produces a schema-valid manifest with element + redacted regions", () => {
    const t = new MappingTable();
    const m = buildManifest({
      image: { w: 1280, h: 800, dpr: 1 },
      elements: [{ id: 1, bbox: [0, 0, 60, 20], role: "button", text: "Login", interactable: true }],
      redacted: [region()],
      mapping: t,
      degraded: false,
    });
    expect(() => RedactionManifestSchema.parse(m)).not.toThrow();
    expect(m.regions.filter((r) => r.kind === "redacted")).toHaveLength(1);
  });

  it("never leaks a raw value and registers every value in the mapping table", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [region()], mapping: t, degraded: false });
    const json = JSON.stringify(m);
    expect(json).not.toContain("9000000000");
    const ph = (m.regions[0] as any).placeholder as string;
    expect(t.resolve(ph)).toBe("9000000000");
    expect((m.regions[0] as any).value_len).toBe(10);
  });

  it("FACE regions get a null value_len and a FACE#n placeholder", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [region({ category: "FACE", value: null })], mapping: t, degraded: false });
    const r = m.regions[0] as any;
    expect(r.value_len).toBeNull();
    expect(r.placeholder).toMatch(/^FACE#/);
  });

  it("adds a degraded note when degraded=true", () => {
    const t = new MappingTable();
    const m = buildManifest({ image: { w: 10, h: 10, dpr: 1 }, elements: [], redacted: [], mapping: t, degraded: true });
    expect(m.notes).toContain("degraded");
  });
});
