import { env } from "@huggingface/transformers";

// MV3 extension pages may not load code from a CDN (CSP: script-src 'self').
// Point the ONNX Runtime at the wasm shipped in extension/public/ort/, and run
// it single-threaded, no worker — extension pages aren't cross-origin isolated
// and a proxy worker would hit the CSP again. Model *weights* are fetched
// (connect-src), not executed, so remote model loading stays enabled.
//
// In Node (the e2e harness) `chrome` is undefined; leave the defaults alone.
const inExtension =
  typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function";

if (inExtension) {
  const wasm = env.backends.onnx.wasm as {
    wasmPaths?: string; numThreads?: number; proxy?: boolean;
  };
  wasm.wasmPaths = chrome.runtime.getURL("ort/");
  wasm.numThreads = 1;
  wasm.proxy = false;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
}

export const IN_EXTENSION = inExtension;
