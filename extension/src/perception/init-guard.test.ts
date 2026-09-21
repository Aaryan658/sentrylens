import { describe, it, expect, vi, beforeEach } from "vitest";

const pipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({ pipeline: (...a: unknown[]) => pipeline(...a) }));
vi.mock("./env.js", () => ({ configureTransformers: () => {} }));

import { initNer, disposeNer } from "./ner.js";

// Models start loading as soon as the offscreen page exists, while a task may
// call initNer at the same moment. Two concurrent loads would each download and
// hold the model, and a failed load must not wedge later attempts.
describe("initNer concurrency", () => {
  beforeEach(async () => {
    await disposeNer();
    pipeline.mockReset();
  });

  it("loads the model once when called concurrently", async () => {
    pipeline.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return { dispose: async () => {} }; });
    await Promise.all([initNer("wasm"), initNer("wasm"), initNer("wasm")]);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("is a no-op once loaded", async () => {
    pipeline.mockResolvedValue({ dispose: async () => {} });
    await initNer("wasm");
    await initNer("wasm");
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it("lets a later call retry after a failed load instead of caching the failure", async () => {
    pipeline.mockRejectedValueOnce(new Error("network"));
    await expect(initNer("wasm")).rejects.toThrow("network");
    pipeline.mockResolvedValue({ dispose: async () => {} });
    await expect(initNer("wasm")).resolves.toBeUndefined();
    expect(pipeline).toHaveBeenCalledTimes(2);
  });
});
