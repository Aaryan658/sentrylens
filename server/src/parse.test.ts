import { describe, it, expect } from "vitest";
import { parseAction } from "./parse.js";

describe("parseAction", () => {
  it("parses a bare JSON object", () => {
    expect(parseAction('{"type":"click","target_id":3,"thought":"go"}')).toEqual({ ok: true, action: { type: "click", target_id: 3, thought: "go" } });
  });
  it("parses a fenced JSON block inside prose", () => {
    const raw = "Sure.\n```json\n{ \"type\": \"done\", \"answer\": \"42\", \"thought\": \"found\" }\n```\n";
    expect(parseAction(raw)).toEqual({ ok: true, action: { type: "done", answer: "42", thought: "found" } });
  });
  it("returns needsRepair on invalid shape", () => {
    expect(parseAction('{"type":"click"}')).toEqual({ ok: false, needsRepair: true });
  });
  it("returns needsRepair on non-JSON", () => {
    expect(parseAction("I cannot help with that")).toEqual({ ok: false, needsRepair: true });
  });
});
