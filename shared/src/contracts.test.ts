import { describe, it, expect } from "vitest";
import {
  RegionListSchema, RedactionManifestSchema, AgentActionSchema,
  ServerRequestSchema, ServerResponseSchema,
} from "./contracts.js";

describe("contracts", () => {
  it("accepts a valid RegionList", () => {
    const v = {
      url: "https://x.test/", viewport: { w: 1280, h: 800, dpr: 1 },
      regions: [{ id: 1, bbox: [0, 0, 10, 10], source: "dom", role: "button", name: "Login", interactable: true }],
    };
    expect(RegionListSchema.parse(v).regions[0]!.name).toBe("Login");
  });

  it("rejects a RegionList with a 3-tuple bbox", () => {
    const v = { url: "u", viewport: { w: 1, h: 1, dpr: 1 }, regions: [{ id: 1, bbox: [0, 0, 10], source: "dom", role: "b", name: "n", interactable: true }] };
    expect(() => RegionListSchema.parse(v)).toThrow();
  });

  it("parses each AgentAction variant and rejects an unknown type", () => {
    expect(AgentActionSchema.parse({ type: "click", target_id: 3, thought: "t" }).type).toBe("click");
    expect(AgentActionSchema.parse({ type: "type", target_id: 3, value: "PHONE_NUMBER#a1b2c", thought: "t" }).type).toBe("type");
    expect(AgentActionSchema.parse({ type: "done", answer: "ok", thought: "t" }).type).toBe("done");
    expect(() => AgentActionSchema.parse({ type: "teleport", thought: "t" })).toThrow();
  });

  it("requires manifest.notes and a literal schema tag", () => {
    const m = { schema: "sentrylens-redaction/1.0", image: { w: 10, h: 10, dpr: 1 }, regions: [], notes: "n" };
    expect(RedactionManifestSchema.parse(m).schema).toBe("sentrylens-redaction/1.0");
    expect(() => RedactionManifestSchema.parse({ ...m, schema: "wrong" })).toThrow();
    expect(() => RedactionManifestSchema.parse({ ...m, notes: undefined })).toThrow();
  });

  it("ServerRequest/Response round-trip", () => {
    const req = { task: "do x", image_b64: "AAAA", manifest: { schema: "sentrylens-redaction/1.0", image: { w: 1, h: 1, dpr: 1 }, regions: [], notes: "n" }, history: [] };
    expect(ServerRequestSchema.parse(req).task).toBe("do x");
    expect(ServerResponseSchema.parse({ action: { type: "done", answer: "a", thought: "t" } }).action.type).toBe("done");
  });
});
