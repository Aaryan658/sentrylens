import { describe, it, expect } from "vitest";
import { luhnValid, verhoeffValid, findStructuredPii, findStructuredPiiDespaced } from "./validators.js";

describe("luhnValid", () => {
  it("accepts a known-good test card", () => expect(luhnValid("4111111111111111")).toBe(true));
  it("accepts a card with spaces", () => expect(luhnValid("4111 1111 1111 1111")).toBe(true));
  it("rejects a bad checksum", () => expect(luhnValid("4111111111111112")).toBe(false));
  it("rejects a random 16-digit order id", () => expect(luhnValid("1234567890123456")).toBe(false));
});

describe("verhoeffValid", () => {
  // 234123412346 is a Verhoeff-valid 12-digit string (checksum digit 6).
  it("accepts a valid 12-digit Aadhaar-shaped number", () => expect(verhoeffValid("234123412346")).toBe(true));
  it("rejects a wrong check digit", () => expect(verhoeffValid("234123412340")).toBe(false));
  it("rejects non-12-digit input", () => expect(verhoeffValid("12345")).toBe(false));
});

describe("findStructuredPii", () => {
  it("finds an email", () => {
    const hits = findStructuredPii("contact ops.lead@vssc.test now");
    expect(hits).toContainEqual(expect.objectContaining({ category: "EMAIL", value: "ops.lead@vssc.test" }));
  });
  it("finds a PAN", () => {
    const hits = findStructuredPii("PAN ABCDE1234F on file");
    expect(hits).toContainEqual(expect.objectContaining({ category: "PAN", value: "ABCDE1234F" }));
  });
  it("finds an IFSC", () => {
    expect(findStructuredPii("SBIN0001234")).toContainEqual(expect.objectContaining({ category: "IFSC", value: "SBIN0001234" }));
  });
  it("only flags a 16-digit run as CREDIT_CARD when Luhn passes", () => {
    expect(findStructuredPii("id 1234567890123456").some((h) => h.category === "CREDIT_CARD")).toBe(false);
    expect(findStructuredPii("card 4111 1111 1111 1111").some((h) => h.category === "CREDIT_CARD")).toBe(true);
  });
  it("only flags a 12-digit run as AADHAAR when Verhoeff passes", () => {
    expect(findStructuredPii("num 234123412340").some((h) => h.category === "AADHAAR")).toBe(false);
    expect(findStructuredPii("uid 2341 2341 2346").some((h) => h.category === "AADHAAR")).toBe(true);
  });
  it("returns char offsets", () => {
    const [hit] = findStructuredPii("x a@b.co");
    expect(hit!.start).toBe(2);
    expect(hit!.end).toBe(8);
  });
});

describe("findStructuredPiiDespaced", () => {
  it("finds a phone number spaced into single-digit tokens", () => {
    const hits = findStructuredPiiDespaced("phone 9 1 2 3 4 5 6 7 8 0 on file");
    expect(hits).toContainEqual(expect.objectContaining({ category: "PHONE_NUMBER", value: "9123456780" }));
  });
  it("returns offsets into the ORIGINAL (spaced) text, not the collapsed one", () => {
    const text = "phone 9 1 2 3 4 5 6 7 8 0 on file";
    const [hit] = findStructuredPiiDespaced(text);
    expect(text.slice(hit!.start, hit!.end)).toBe("9 1 2 3 4 5 6 7 8 0");
  });
  it("returns nothing when there is no spaced-digit run", () => {
    expect(findStructuredPiiDespaced("card 4111 1111 1111 1111")).toEqual([]);
  });
  it("does not fabricate a hit from an unrelated single space between two digits", () => {
    // "id 5 6" is just two digits, not the 3+ run the collapse targets.
    expect(findStructuredPiiDespaced("id 5 6 filed")).toEqual([]);
  });
});
