import { describe, it, expect, vi } from "vitest";

// ocr.ts imports tesseract.js at module load; the scaling logic under test is
// pure, so stub the engine.
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

import { pickOcrScale, scaleOcrResult, OCR_UPSCALE, OCR_UPSCALE_MAX_PIXELS } from "./ocr.js";

describe("pickOcrScale", () => {
  it("upscales a small screenshot: Tesseract misses ~14px UI text at 1x (phone, email, card values on a real page)", () => {
    expect(pickOcrScale(760, 640)).toBe(OCR_UPSCALE);
    expect(pickOcrScale(1280, 720)).toBe(OCR_UPSCALE);
  });

  it("leaves a large screenshot alone (2x would make OCR too slow; rescue still covers blind spots)", () => {
    expect(pickOcrScale(1920, 1080)).toBe(1);
    expect(pickOcrScale(2560, 1440)).toBe(1);
  });

  it("cuts over exactly at the pixel budget", () => {
    expect(pickOcrScale(OCR_UPSCALE_MAX_PIXELS, 1)).toBe(OCR_UPSCALE);
    expect(pickOcrScale(OCR_UPSCALE_MAX_PIXELS + 1, 1)).toBe(1);
  });

  it("never scales a degenerate image", () => {
    expect(pickOcrScale(0, 0)).toBe(1);
    expect(pickOcrScale(-5, 100)).toBe(1);
  });
});

describe("scaleOcrResult", () => {
  it("maps word boxes from upscaled space back to screenshot pixels", () => {
    const out = scaleOcrResult(
      { words: [{ text: "hi", bbox: [40, 20, 60, 24] }], joined: "hi", offsets: [0] },
      2,
    );
    expect(out.words[0]!.bbox).toEqual([20, 10, 30, 12]);
    expect(out.joined).toBe("hi");
    expect(out.offsets).toEqual([0]);
  });

  it("is the identity at factor 1", () => {
    const r = { words: [{ text: "a", bbox: [1, 2, 3, 4] as [number, number, number, number] }], joined: "a", offsets: [0] };
    expect(scaleOcrResult(r, 1)).toBe(r);
  });
});
