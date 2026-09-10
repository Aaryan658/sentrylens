import { env } from "@huggingface/transformers";

// MV3 extension pages may not load code from a CDN (CSP: script-src 'self').
// Point transformers.js / ONNX Runtime at the wasm+glue shipped in
// extension/public/ort/, single-threaded, no proxy worker (extension pages
// aren't cross-origin isolated). Model *weights* are fetched, not executed, so
// remote model loading stays enabled.
//
// transformers.js resets wasmPaths to its own jsdelivr CDN URL during its
// module-init, so a one-shot assignment at import time can lose the race with
// bundlers that defer that init. configureTransformers() is therefore also
// called just-in-time from each perception module, right before the first
// pipeline() — at which point nothing can overwrite it again.
//
// In Node (the e2e harness) `chrome` is undefined; leave the defaults alone.
const inExtension =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function";

export function configureTransformers(): void {
  if (!inExtension) return;
  const wasm = env.backends.onnx.wasm as {
    wasmPaths?: string; numThreads?: number; proxy?: boolean;
  };
  const local = chrome.runtime.getURL("ort/");
  if (wasm.wasmPaths === local) return;
  wasm.wasmPaths = local;
  wasm.numThreads = 1;
  wasm.proxy = false;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  console.log("[sentrylens] ORT wasmPaths =", local);
}

configureTransformers();

export const IN_EXTENSION = inExtension;
