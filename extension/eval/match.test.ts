import { describe, it, expect } from "vitest";
import { matchValue } from "./match.js";

describe("matchValue", () => {
  it("matches a phone number regardless of spacing (numeric category)", () => {
    expect(matchValue("9123456780", "9123 456 780", "PHONE_NUMBER")).toBe(true);
  });

  it("matches an Aadhaar number regardless of formatting", () => {
    expect(matchValue("2341 2341 2346", "234123412346", "AADHAAR")).toBe(true);
  });

  it("rejects a numeric mismatch", () => {
    expect(matchValue("9123456780", "9123456781", "PHONE_NUMBER")).toBe(false);
  });

  it("matches a name case-insensitively with collapsed whitespace", () => {
    expect(matchValue("R.  Iyer", "r. iyer", "PERSON_NAME")).toBe(true);
  });

  it("matches an email exactly (case-insensitive)", () => {
    expect(matchValue("Ops@VSSC.test", "ops@vssc.test", "EMAIL")).toBe(true);
  });

  it("rejects a text mismatch", () => {
    expect(matchValue("R. Iyer", "K. Bhatt", "PERSON_NAME")).toBe(false);
  });

  it("matches a name despite OCR misreading capital I as lowercase l", () => {
    expect(matchValue("R. lyer", "R. Iyer", "PERSON_NAME")).toBe(true);
  });
});
