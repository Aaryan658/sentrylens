import { describe, it, expect } from "vitest";
import { findLabeledNames } from "./names.js";

describe("findLabeledNames", () => {
  it("catches an initial-surname name after a plain label with extra spacing", () => {
    const hits = findLabeledNames("Operator    R. Iyer");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ category: "PERSON_NAME", value: "R. Iyer" });
  });

  it("catches a name after a compound label without over-consuming the label word", () => {
    const hits = findLabeledNames("Beneficiary K. Bhatt");
    expect(hits).toEqual([{ category: "PERSON_NAME", value: "K. Bhatt", start: 12, end: 20 }]);
  });

  it("catches a name mid-sentence right after the label word", () => {
    const hits = findLabeledNames("Approve payment for operator M. Rao");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("M. Rao");
  });

  it("prefers the longer compound label so the name doesn't swallow it", () => {
    const hits = findLabeledNames("Employee Name Anita Rao");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("Anita Rao");
  });

  it("finds a name in a realistic multi-field roster line (the case the NER model misses)", () => {
    const text = "Duty roster - station VSSC-03 Operator R. Iyer Phone 9123456780 Email r.iyer@vssc.test PAN BNZAA2318K Password skyfall99";
    const hits = findLabeledNames(text);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("R. Iyer");
    expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe("R. Iyer");
  });

  it("does not match a label with no name-shaped text after it", () => {
    expect(findLabeledNames("Operator on duty since 0800")).toHaveLength(0);
  });

  it("does not match unrelated capitalized text with no preceding label", () => {
    expect(findLabeledNames("Status Nominal, filed by Duty Engineer")).toHaveLength(0);
  });

  it("does not match a label followed by lowercase text", () => {
    expect(findLabeledNames("contact support for help")).toHaveLength(0);
  });

  it("catches a name whose leading letter OCR misread as lowercase l instead of capital I", () => {
    const hits = findLabeledNames("Operator R. lyer");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("R. lyer");
  });

  it("does not take the next form field's label as a name (was masking 'Operator ID Password' as a person)", () => {
    expect(findLabeledNames("Operator sign-in Operator ID Password Duty roster")).toHaveLength(0);
  });

  it("does not let a trailing field label ride along on a real name", () => {
    const hits = findLabeledNames("Operator Anita Phone 9123456780");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("Anita");
  });

  it("handles a label with a trailing colon", () => {
    const hits = findLabeledNames("Patient: Meera Nair");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.value).toBe("Meera Nair");
  });
});
