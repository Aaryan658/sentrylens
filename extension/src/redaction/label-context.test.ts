import { describe, it, expect } from "vitest";
import { inferCategoryFromLabel } from "./label-context.js";

describe("inferCategoryFromLabel", () => {
  it("picks AADHAAR from a nearby 'Aadhaar:' label on the same row", () => {
    const ocrWords = [{ text: "Aadhaar:", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("AADHAAR");
  });

  it("picks PERSON_NAME from a nearby 'Operator' label", () => {
    const ocrWords = [{ text: "Operator", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("PERSON_NAME");
  });

  it("returns null when no label word is anywhere nearby (must not guess)", () => {
    const ocrWords = [{ text: "Aadhaar:", bbox: [20, 40, 70, 20] as const }];
    const farAway: [number, number, number, number] = [900, 700, 150, 20];
    expect(inferCategoryFromLabel(farAway, ocrWords as any)).toBeNull();
  });

  it("returns null when nearby text isn't a known label", () => {
    const ocrWords = [{ text: "Reference:", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBeNull();
  });

  it("matches a multi-word label spanning adjacent OCR words ('Credit Card')", () => {
    const ocrWords = [
      { text: "Credit", bbox: [20, 40, 50, 20] as const },
      { text: "Card", bbox: [72, 40, 40, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [130, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("CREDIT_CARD");
  });

  it("prefers PERSON_NAME for 'Contact' to preserve findLabeledNames' existing semantics", () => {
    const ocrWords = [{ text: "Contact", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("PERSON_NAME");
  });

  it("does not match a label word that is far off-screen from the blind spot", () => {
    const ocrWords = [{ text: "Password:", bbox: [20, 500, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBeNull();
  });

  it("recognizes the common misspelling 'Aadhar' (missing second 'a')", () => {
    const ocrWords = [{ text: "Aadhar:", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("AADHAAR");
  });

  it("recognizes 'Mob No' as PHONE_NUMBER", () => {
    const ocrWords = [
      { text: "Mob", bbox: [20, 40, 30, 20] as const },
      { text: "No", bbox: [52, 40, 20, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("PHONE_NUMBER");
  });

  it("recognizes 'A/C No' as BANK_ACCOUNT", () => {
    const ocrWords = [
      { text: "A/C", bbox: [20, 40, 30, 20] as const },
      { text: "No", bbox: [52, 40, 20, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("BANK_ACCOUNT");
  });

  it("recognizes 'Driving Licence' as GOV_ID", () => {
    const ocrWords = [
      { text: "Driving", bbox: [20, 40, 60, 20] as const },
      { text: "Licence", bbox: [82, 40, 60, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [160, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("GOV_ID");
  });

  it("recognizes 'Mail ID' as EMAIL", () => {
    const ocrWords = [
      { text: "Mail", bbox: [20, 40, 40, 20] as const },
      { text: "ID", bbox: [62, 40, 20, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("EMAIL");
  });

  it("picks the NEAREST label, not the first one in reading order (was labelling a Password-row box as EMAIL)", () => {
    const ocrWords = [
      { text: "Email", bbox: [20, 100, 50, 20] as const },
      { text: "PAN", bbox: [20, 140, 40, 20] as const },
    ];
    const blindSpot: [number, number, number, number] = [100, 140, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("PAN");
  });

  it("does not use a label from an earlier row that is not directly above the blind spot", () => {
    const ocrWords = [{ text: "Email", bbox: [20, 100, 50, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 200, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBeNull();
  });

  it("uses a label directly above the blind spot (label-over-input forms)", () => {
    const ocrWords = [{ text: "Password", bbox: [37, 200, 70, 16] as const }];
    const blindSpot: [number, number, number, number] = [37, 226, 278, 32];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBe("PASSWORD");
  });

  it("ignores a label that sits after or below the blind spot (a label precedes its value)", () => {
    const ocrWords = [{ text: "Aadhaar:", bbox: [300, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBeNull();
    const below = [{ text: "Aadhaar:", bbox: [100, 70, 70, 20] as const }];
    expect(inferCategoryFromLabel(blindSpot, below as any)).toBeNull();
  });

  it("does NOT treat bare 'PIN' as PASSWORD (ambiguous with a postal PIN code, deliberately excluded)", () => {
    const ocrWords = [{ text: "PIN:", bbox: [20, 40, 70, 20] as const }];
    const blindSpot: [number, number, number, number] = [100, 40, 150, 20];
    expect(inferCategoryFromLabel(blindSpot, ocrWords as any)).toBeNull();
  });
});
