import { describe, it, expect } from "vitest";
import { MappingTable } from "./mapping.js";

describe("MappingTable", () => {
  it("returns the same placeholder for the same value", () => {
    const t = new MappingTable();
    const a = t.placeholderFor("PHONE_NUMBER", "9000000000");
    const b = t.placeholderFor("PHONE_NUMBER", "9000000000");
    expect(a).toBe(b);
    expect(a).toMatch(/^PHONE_NUMBER#[a-z0-9]{5}$/);
  });

  it("normalises whitespace/case for names before hashing", () => {
    const t = new MappingTable();
    expect(t.placeholderFor("PERSON_NAME", "  Anita   Rao ")).toBe(t.placeholderFor("PERSON_NAME", "anita rao"));
  });

  it("normalises to digits for numeric categories", () => {
    const t = new MappingTable();
    expect(t.placeholderFor("AADHAAR", "2341 2341 2346")).toBe(t.placeholderFor("AADHAAR", "234123412346"));
  });

  it("reuses a placeholder for an OCR-noisy near-match (Levenshtein <= 2)", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("PERSON_NAME", "anita rao");
    expect(t.placeholderFor("PERSON_NAME", "an1ta rao")).toBe(p);
  });

  it("resolves a placeholder back to the real value", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("EMAIL", "ops@vssc.test");
    expect(t.resolve(p)).toBe("ops@vssc.test");
    expect(t.resolveAll(`login ${p} now`)).toBe("login ops@vssc.test now");
  });

  it("two tables with different session keys produce different placeholders", () => {
    expect(new MappingTable().placeholderFor("EMAIL", "a@b.co"))
      .not.toBe(new MappingTable().placeholderFor("EMAIL", "a@b.co"));
  });

  it("clear() drops all entries", () => {
    const t = new MappingTable();
    const p = t.placeholderFor("EMAIL", "a@b.co");
    t.clear();
    expect(t.resolve(p)).toBeUndefined();
  });
});
