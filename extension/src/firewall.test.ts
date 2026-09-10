import { describe, it, expect } from "vitest";
import { buildBlockRules, ALLOWLIST } from "./firewall.js";

describe("buildBlockRules", () => {
  it("produces one block-all rule plus an allow rule per allowlisted host", () => {
    const rules = buildBlockRules();
    const allow = rules.filter((r) => r.action.type === "allow");
    const block = rules.filter((r) => r.action.type === "block");
    expect(block).toHaveLength(1);
    expect(allow.map((r) => r.condition.requestDomains?.[0]).sort()).toEqual([...ALLOWLIST].sort());
  });

  it("allow rules outrank the block rule", () => {
    const rules = buildBlockRules();
    const block = rules.find((r) => r.action.type === "block")!;
    const allow = rules.find((r) => r.action.type === "allow")!;
    expect(allow.priority!).toBeGreaterThan(block.priority!);
  });

  it("every rule id is unique", () => {
    const ids = buildBlockRules().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
