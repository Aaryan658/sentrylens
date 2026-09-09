# SIH26171 — On-Device Visual Perception for Light-weight Browser Agents
## Deep Research Report & Winning Build Strategy

*Generated: 2026-09-09 | Organisation: ISRO | Verdict on portal: YELLOW (workable, generic-execution risk) | Sources analysed: 35+ | Confidence: High on tech stack, Medium on evaluator preferences*

---

## 1. Executive Summary

The problem asks for a **client-side (browser extension + in-page) vision agent** that (a) runs a local Vision Transformer / CV model over the user's screen via **WebGPU**, (b) **detects and redacts sensitive/PII regions locally** (faces, passwords, names, card numbers, Aadhaar/PAN, etc.) using a mix of **DOM signals and vision bounding-boxes**, and (c) sends only the **sanitised visual context** to a **server-side open-weight LLM/VLM** that is *aware of the redaction scheme* and acts/answers on the masked data.

This is a **known, active research area in 2025–2026** ("privacy-preserving GUI agents" / "trustworthy local–remote hybrid"). At least five recent papers describe almost exactly this pipeline for *mobile* GUI agents — **GUIGuard, "Available but Invisible" (anonymisation framework), MaskClaw, DualTAP/PrivScreen, VisShield**. **Almost none target the browser**, and none ship as a polished WebGPU browser extension. That gap is your differentiation: *port the research-grade privacy pipeline to a real, installable Chrome/Edge MV3 extension with on-device WebGPU perception, and make the redaction scheme a first-class, reversible contract between client and server.*

The whole stack is buildable in 36 hours because every layer has a mature open-source component:
- **In-browser perception:** Transformers.js v4 / ONNX Runtime Web + WebGPU (Chrome/Edge 113+). Small VLMs (SmolVLM-256M/500M, FastVLM-0.5B, Moondream2) and detectors (YOLO/YOLOS/RT-DETR, MediaPipe Face) run at interactive speeds.
- **Privacy filter:** Tesseract.js / PaddleOCR-wasm for OCR + GLiNER.js (GLiNER PII ONNX) for on-device NER + regex/checksum validators (Luhn for cards, Verhoeff for Aadhaar) + MediaPipe/YuNet for faces. Canvas redaction (black-box > pixelate > blur).
- **Server VLM:** Any offline-deployable open-weight model — Qwen2.5-VL-7B/32B, InternVL3-8B/14B, MiniCPM-V 2.6, or a GUI-specialist grounder (OS-Atlas-7B, UGround-V1-7B, UI-TARS-1.5-7B). Cloud-hosted versions allowed *during* SIH.

**Biggest risk (from the portal analysis):** generic execution. Three other 2026 statements are "genuinely similar." Win on **(1) a working WebGPU demo that provably never leaks pixels** (airplane-mode / network-firewall proof), **(2) a rigorous, reversible redaction protocol the server understands**, and **(3) an honest privacy–utility evaluation** with numbers.

---

## 2. Decoding the Problem & What ISRO Evaluators Will Reward

### 2.1 The five explicit deliverables (from the PS "Expected Solution")
| # | Ask | What it concretely means |
|---|-----|--------------------------|
| 1 | **Local vision processing** | A client-side vision model (ViT/VLM/detector) running in-browser via WebGPU that "reads" the current screen state and informs decisions. |
| 2 | **Privacy-preserving filter** | Local mechanism to sanitise sensitive visual data — bounding-box redaction, semantic obfuscation, masking. Must *dynamically detect* faces, passwords, PII. |
| 3 | **Server-side integration** | Transmit the anonymised visual context to a centralised LLM/VLM that *interprets sanitised data and returns a usable response/action*. |
| 4 | **Redaction-aware server** | The server must "be aware of this redaction scheme and can process data accordingly" — i.e. a *contract*, not just a blurred JPEG. |
| 5 | **Working prototype** | Client extension + server, running in *popular browsers*, end-to-end demo. Offline-deployable open-weight server model (cloud-hosted OK during SIH). |

### 2.2 Evaluator scorecard signals (from the portal) and how to hit them
- **Innovation = Breakthrough** (CV + LLM). Don't build a "UI wrapper around a database." Show the ViT/WebGPU pipeline running live.
- **Invention effort = Medium (score 7)**, "7 distinct components," flags: **offline handling, third-party integration, cloud infrastructure**. Explicitly demo the offline path (extension works with no network after model cache) and a clean client↔server integration.
- **Architecture = Multi-Layer (3-layer)**: perception layer → redaction/logic layer → server VLM, surfaced through the extension UI. *"Most bugs show up at the seams between layers"* — integrate end-to-end by hour 20, not hour 30.
- **Predicted evaluator questions** (prep answers): data provenance (real vs synthetic screenshots), why this level of tech is not overkill, graceful degradation when connectivity/hardware fails, production-scale behaviour, who benefits + how you measure success.
- **ISRO / space angle:** "why it matters" is generic in the PS; tie it to a concrete ISRO-flavoured workflow — e.g. an analyst using a cloud AI copilot over **Bhoonidhi / MOSDAC / internal dashboards** where screen contents (project codes, personnel names, coordinates, station IDs) must never reach a third-party model. Frame it as *"sovereign, privacy-preserving agentic assistance for operators of sensitive government systems."*

---

## 3. Recommended Reference Architecture

```
┌─────────────────────────────  BROWSER (client, trusted)  ─────────────────────────────┐
│                                                                                       │
│  CONTENT SCRIPT (per tab)              OFFSCREEN DOCUMENT (WebGPU, persistent)          │
│  ─────────────────────────             ──────────────────────────────────────          │
│  • DOM walk: collect elements,         • ONNX Runtime Web / Transformers.js v4          │
│    roles, bounding rects, input        • Model A: UI element / region detector          │
│    types, aria, contenteditable          (YOLO/RT-DETR/OmniParser-style) OR             │
│  • Flag sensitive DOM: <input           small VLM (SmolVLM-256M / FastVLM-0.5B)         │
│    type=password>, autocomplete=cc-*,  • Model B: face detector (MediaPipe/YuNet)       │
│    aria-label~=PII, [data-sensitive]   • Model C: on-device NER (GLiNER PII ONNX)       │
│  • html2canvas / getDisplayMedia /     • OCR: Tesseract.js / Paddle-wasm (text+bbox)    │
│    chrome.tabs.captureVisibleTab       • Fuse DOM boxes + vision boxes + OCR+NER        │
│         │                                        │                                     │
│         ▼                                        ▼                                     │
│              ┌────────────  REDACTION ENGINE (trusted)  ────────────┐                   │
│              │ • Sensitivity classifier → risk level per region     │                   │
│              │ • Canvas ops: black-box / pixelate / semantic swap   │                   │
│              │ • Session mapping table: value ⇄ PLACEHOLDER#hash    │  (never leaves)   │
│              │ • Emits: sanitised PNG + redaction manifest (JSON)   │                   │
│              └───────────────────────┬─────────────────────────────┘                   │
│  SERVICE WORKER (router)             │                                                 │
│  • message bus, screenshot capture   │  sanitised image + manifest only                │
└──────────────────────────────────────┼─────────────────────────────────────────────────┘
                                       ▼
┌──────────────────────  SERVER (untrusted, open-weight VLM)  ──────────────────────┐
│  • Receives: sanitised screenshot + redaction manifest                             │
│      manifest = [{id, bbox, category:"PHONE", placeholder:"PHONE#a1b2", length}]    │
│  • Redaction-aware system prompt: "Regions marked PLACEHOLDER#… are anonymised;     │
│    reason over category + position + length; emit actions by region id or coords." │
│  • Model: Qwen2.5-VL-7B / InternVL3-8B / MiniCPM-V 2.6 (+ optional grounder)        │
│  • Returns: answer text and/or action {type:"click", target_id:12} | {type:"type", │
│    target_id:5, value:"PHONE#a1b2"}                                                 │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       ▼
      CLIENT resolves placeholders → real values via mapping table, executes action
      (click centroid of bbox, type real string) entirely locally.
```

### 3.1 Why this shape (backed by prior art)
- **"Trustworthy local–remote hybrid"** is the exact paradigm named by GUIGuard and the "Available but Invisible" paper: raw interface visible only on device; anything sent out is sanitised first; a **local Secure Interaction Proxy** resolves the remote agent's placeholder-bearing commands back to real values. ([GUIGuard](https://arxiv.org/html/2601.18842v2), [Available but Invisible](https://arxiv.org/html/2602.10139v3))
- **Deterministic, type-preserving placeholders** (`PHONE_NUMBER#a1b2c`) keep the server able to reason (category, length, layout) without seeing the value; a **session-scoped mapping table stays inside the trust boundary**. ([Available but Invisible](https://arxiv.org/html/2602.10139v3))
- **High-contrast masks, not background-colour fills.** GUIGuard found that if the mask blends in, the VLM assumes "nothing there" and loses information; a visible blackout + `[REDACTED]`/`[PRIVATE]` marker lets the agent *reason about what's missing*. Optionally render the placeholder text scaled into the box so the VLM infers category and value length. ([GUIGuard](https://arxiv.org/html/2601.18842v2), [Available but Invisible](https://arxiv.org/html/2602.10139v3))
- **Only "type" actions carry text/placeholders**; spatial actions (click/scroll/long-press) use numeric region indices → coordinates, so anonymisation tags never appear in spatial commands. Borrow this clean command grammar from the "Available but Invisible" Secure Interaction Proxy.
- **Consistency across steps:** the same entity must map to the same placeholder across screens or the task context breaks — maintain a cross-step replacement memory (GUIGuard, Available-but-Invisible both stress this).

---

## 4. Sub-system 1 — In-Browser Visual Perception (WebGPU)

### 4.1 Runtime choice
| Runtime | Use it for | Notes |
|---|---|---|
| **Transformers.js v4** (`@huggingface/transformers`) | Fastest path to VLMs, detectors, OCR, NER via one `pipeline()` API; WebGPU is default backend where supported | v4 made native WebGPU EP default; `device:'webgpu'`, `dtype:'q4f16'` (WebGPU) / `'q8'` (WASM). ([HF WebGPU guide](https://huggingface.co/docs/transformers.js/en/guides/webgpu), [v4 PR](https://github.com/xenova/transformers.js/pull/1382)) |
| **ONNX Runtime Web** (direct) | Custom YOLO/RT-DETR detectors, IO-binding to keep tensors on GPU between frames, WebNN/NPU path | More control over quantisation & execution providers. ([codersarts](https://www.codersarts.com/post/how-to-run-ai-models-directly-in-the-browser-with-transformers-js-and-webgpu)) |
| **WebLLM (MLC)** | If you want a *chat-capable* on-device LLM planner (Qwen2.5-1.5B, Llama-3.2-1B/3B) with OpenAI-style streaming | Used by OmniBrowser/Nanobrowser-style agents; ~600–800 MB models. ([omnibrowser-agent](https://github.com/akshayram1/omnibrowser-agent)) |
| **MediaPipe Tasks-Vision** | Face detection / landmarks, hand/pose; very optimised | `@mediapipe/tasks-vision`, run in a worker to avoid blocking. ([Google face detector web](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js)) |

**Backend rule of thumb** ([SitePoint benchmark](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)): WebGPU wins big for >100M-param models and autoregressive generation (10–15× over WASM); WASM matches or beats WebGPU for tiny single-pass models (embeddings, single image classification <15 ms). **Always ship a WASM fallback** — `navigator.gpu` existing ≠ usable adapter; `await navigator.gpu.requestAdapter()` can return null on VMs/old GPUs. Check `shader-f16` feature for `q4f16`.

### 4.2 Model options for the "vision reads the screen" component
Two design choices — pick based on demo ambition:

**Option A (robust, recommended for 36h): detector + OCR, no in-browser VLM.**
- **Interactable-region detector:** OmniParser-style (fine-tuned YOLOv8/YOLOv9 icon detector, publicly available weights) or a generic `Xenova/yolos-tiny` / RT-DETR ONNX (~26 MB) for person/screen/phone/laptop. OmniParser converts a screenshot into a **structured list of elements + bounding boxes + numeric IDs + icon captions** — exactly the "structured screen state" the PS wants, and it's designed to be VLM-plugin-ready. ([OmniParser V2](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/), [repo](https://github.com/microsoft/OmniParser))
- **OCR:** Tesseract.js (100+ languages, per-word bboxes, WASM+worker) or a PaddleOCR-wasm port (`ppu-paddle-ocr`, PP-OCRv5, better on dense/CJK/Indic, WebGPU→WASM fallback). ([Loft Tools OCR review](https://lofttools.com/blog/on-device-ocr-reviewed/))
- This alone satisfies deliverable 1 ("a client-side vision model that evaluates the current screen state") and gives you clean, cheap, explainable structure.

**Option B (flashier): small VLM in-browser.**
- **SmolVLM-256M / 500M-Instruct** — smallest usable VLM, <1 GB GPU RAM, ~80 decode tok/s on an M4 Max in-browser; official `smolvlm-webgpu` Transformers.js example + real-time webcam Space. ([SmolVLM paper](https://arxiv.org/html/2504.05299), [HF example](https://github.com/huggingface/transformers.js-examples/tree/main/smolvlm-webgpu), [pyimagesearch walkthrough](https://pyimagesearch.com/2025/10/20/running-smolvlm-locally-in-your-browser-with-transformers-js/))
- **FastVLM-0.5B (Apple)** — `apple/FastVLM-0.5B` ONNX; FastViTHD encoder → up to 85× faster time-to-first-token vs LLaVA-OneVision-0.5B; official Transformers.js + WebGPU webcam demo. ~300 MB quantised. ([ai-engineer tutorial](https://www.ai-engineer.io/tutorials/video-a11y-captions-in-the-browser), [fastvlm.net](https://fastvlm.net/demo))
- **Moondream2 (~1.8B)** — strong OCR/counting/captioning at edge sizes.
- Realistic in-browser latency: ~0.8 s/inference on M1, 2–3 s on integrated-GPU Windows laptops. Capture a frame every ~2 s, never per-frame.

> **Best of both:** use Option A's detector+OCR to build structure every step (fast, deterministic), and optionally run a small VLM (Option B) once per task for a natural-language "screen summary" to impress evaluators. Keep the heavy semantic reasoning on the server VLM.

### 4.3 Chrome MV3 architecture gotchas (critical — costs teams hours)
- **Do NOT run ONNX/WASM/WebGPU in the MV3 service worker.** It's ephemeral (suspended ~30 s idle), GC's your loaded model, and its CSP blocks a lot. ([dev.to writeup](https://dev.to/sathiyasenpai/why-i-moved-my-transformersjs-pipeline-out-of-the-chrome-mv3-service-worker-and-into-an-offscreen-1kk4))
- **Use the Offscreen Document API** (`chrome.offscreen`, Chrome 109+): a hidden full-DOM page that stays resident, supports WASM/WebGPU/SharedArrayBuffer, loads your models once. **One offscreen doc per extension** → use a keyed pipeline registry for multiple models. ([chrome.offscreen docs](https://developer.chrome.com/docs/extensions/reference/api/offscreen))
- Canonical layout (used by `gemma-gem`, `ToS_Shield`, `local-ai-browser-extension`):
  - **Offscreen document:** hosts models + inference + (optionally) the agent loop.
  - **Service worker:** message router; `chrome.tabs.captureVisibleTab` for screenshots; `run_javascript`.
  - **Content script:** DOM read/walk, element highlight, `click_element` / `type_text` / `scroll_page` tools, shadow-DOM overlay UI.
  - `manifest.json`: `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`, `"permissions": ["offscreen","tabs","scripting","storage","activeTab"]`.
- **COOP/COEP headers** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) needed for multi-threaded WASM (`SharedArrayBuffer`); without them ORT silently drops to single-thread (2–4× slower). Extension pages are cross-origin isolated by default in MV3, but verify `self.crossOriginIsolated === true`.
- **Model caching:** Cache API / IndexedDB — first load 30–60 s for a few-hundred-MB model, instant after. Ship a **Service Worker network-firewall** that, once models are warm, blocks *all* outbound requests → *verifiable proof no pixels leave the browser* (do this — it's the single most convincing demo move; `image-pii-redactor` and `w3pn-anonymizer` both do it).

---

## 5. Sub-system 2 — The Privacy-Preserving Filter (the heart of the score)

### 5.1 Detection stack (hybrid = high recall, the research consensus)
Run these locally and **fuse** the results into one list of `{bbox, category, source, confidence, risk, task_necessary}`:

| Signal | Tool | Catches |
|---|---|---|
| **DOM structural** | content-script walk | `<input type="password">`, `autocomplete="cc-number|cc-csc|tel|email"`, `type="email\|tel"`, `aria-label`/`name` matching PII patterns, `[data-sensitive]`, contenteditable near labelled fields. *Highest precision — use as ground truth where available.* |
| **Face / person** | MediaPipe Face Detector (BlazeFace) or **YuNet ONNX** (`face_detection_yunet_2023mar.onnx` via ORT-Web) | faces, and via YOLO `person`/`tv`/`laptop`/`cell phone` classes: bystander screens, reflections |
| **Text OCR** | Tesseract.js / Paddle-wasm | all rendered text + word-level bounding boxes (needed to place redaction boxes on burned-in pixels the DOM can't see — images, canvas, video) |
| **NER on OCR text** | **GLiNER PII** (`onnx-community/gliner-pii` / `gliner_small-v2`) via **GLiNER.js** (WebGPU/WASM) or `onnx-community/multilang-pii-ner-ONNX` via Transformers.js | names, addresses, orgs, DOB, emails, phones — zero-shot, label-guided |
| **Regex + checksum validators** | JS | structured PII with *mathematical validation to kill false positives*: **Luhn** (credit cards), **Verhoeff** (Aadhaar), PAN entity regex, IFSC/bank codes, SSN, IP, API keys, IBAN mod-97. ([ScreenMask](https://getscreenmask.com/) uses exactly Luhn+Verhoeff+PAN) |

Prior art doing precisely this: **`image-pii-redactor`** (Tesseract.js + multilingual PII NER + regex fallback, SVG review overlay, Service-Worker firewall), **`pii-browser`** (Rust/WASM core + GLiNER + placeholder catalog + de-obfuscation of the LLM response), **`w3pn-anonymizer`** (YuNet faces + YOLO + Tesseract, 10 redaction effects, fully in-browser on ORT-Web), **`safeclipper`** (OCR → OpenAI Privacy-Filter q4 ONNX → mask before it leaves), **`brianstm/pii-ka-boo`** (detect → `[NAME_1]` placeholders → cloud AI → restore locally — a hackathon winner pattern). The "Available but Invisible" paper's reference impl uses **EasyOCR + GLiNER (gliner-pii-large-v1.0, threshold 0.5) + regex fallback**.

### 5.2 Redaction operators (offer 3, default to the safe one)
| Style | Reversibility risk | Use for |
|---|---|---|
| **Solid black box** (+ `[CATEGORY#hash]` label rendered in-box) | **None** — pixels replaced | Default. Passwords, full name+DOB, card/Aadhaar/PAN, signatures, faces on sensitive docs. |
| **Pixelate / mosaic** | Low–moderate (partially reversible by trained models at low block size) | "Everyday" redactions where the screenshot should still tell a story. |
| **Gaussian blur** | Comparable to pixelate; aesthetic only, *not a security control* | Marketing-style soft redaction; avoid for real secrets. |
| **Semantic replacement** (re-render anonymised text into the box, or regenerate the crop) | None if done right; preserves task semantics best | Advanced/bonus: keeps layout + category + plausible value so the server VLM grounds better. GUIGuard's "Replace" mode; `tanaos-text-anonymizer` as reference. |
| **Adversarial perturbation** (DualTAP) | Keeps image *looking* normal to agent VLM while blocking a router VLM's PII extraction | Research bonus; a U-Net generator with contrastive attention. Probably too heavy for 36h but cite it as future work. ([DualTAP](https://arxiv.org/html/2511.13248), [repo](https://github.com/fyzhang1/DualTAP)) |

**Key design details from the papers:** mask colour must contrast with local UI so the VLM knows content was removed (not absent); scale placeholder text to fit the bbox so category + length are inferable; OCR strings are normalised and **fuzzy-matched** against the mapping table so the same entity (with OCR noise) reuses its placeholder.

### 5.3 The redaction manifest (your "scheme the server is aware of")
This JSON is what makes deliverable 4 real. Send it alongside the sanitised PNG:

```jsonc
{
  "schema": "sbva-redaction/1.0",
  "image": { "w": 1280, "h": 800, "dpr": 1 },
  "regions": [
    { "id": 1, "bbox": [10, 20, 80, 30], "kind": "element", "role": "button",
      "text": "Submit", "interactable": true },
    { "id": 2, "bbox": [10, 60, 200, 24], "kind": "redacted", "category": "PHONE_NUMBER",
      "placeholder": "PHONE_NUMBER#a1b2c", "value_len": 10, "risk": "high",
      "style": "blackbox", "task_necessary": true },
    { "id": 3, "bbox": [400, 40, 64, 64], "kind": "redacted", "category": "FACE",
      "placeholder": "FACE#3", "style": "blackbox", "risk": "medium" }
  ],
  "notes": "Regions with kind=redacted are anonymised. Reason over category, position, length. Refer to elements by id. Only 'type' values may contain placeholders."
}
```

Server system prompt tells the VLM the rules; server returns `{action:"type", target_id:2, value:"PHONE_NUMBER#a1b2c"}` or `{action:"click", target_id:1}` or a text answer with placeholders. Client re-substitutes from the **mapping table that never left the device** and executes. This is the "Secure Interaction Proxy" pattern, adapted to the browser.

---

## 6. Sub-system 3 — Sanitised Transmission + Server-Side VLM

### 6.1 Open-weight, offline-deployable server models (PS allows cloud-hosted during SIH)
| Model | Size | Why | Grounding / agent fit |
|---|---|---|---|
| **Qwen2.5-VL-7B-Instruct** | ~6 GB (Q4 fits 1× 24 GB GPU) | Best all-round open VLM for this: native **point & box grounding incl. UI elements as objects**, dynamic resolution, JSON coordinate output, agent-trained. ScreenSpot 55.5 / ScreenSpot-Pro 23.9 (3B); 7B/32B higher. | Excellent — can output click coordinates directly. ([Qwen2.5-VL paper](https://arxiv.org/pdf/2502.13923), [3B card](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct)) |
| **InternVL3-8B / 14B** | 8–15 GB | Strong perception+reasoning, native multimodal pre-training incl. **GUI tasks & tool use**; beats Qwen2.5 on several benches. | Good. ([InternVL3 blog](https://internvl.github.io/blog/2025-04-11-InternVL-3.0/)) |
| **MiniCPM-V 2.6** | ~5.5 GB, 8B | SOTA OCRBench (>GPT-4o), 640 tokens for a 1.8 MP image → fast first-token, runs on llama.cpp/ollama, even iPad. Great if server is CPU-only. | Decent; not GUI-specialised. ([MiniCPM-V](https://github.com/qyc-98/MiniCPM-V)) |
| **UI-TARS-1.5-7B** (ByteDance) | 7B | Purpose-built GUI agent: **ScreenSpot-V2 94.2, ScreenSpot-Pro 49.6/61.6**, OSWorld strong. If your demo is "agent acts," this is the grounder to beat. Open weights. | Best-in-class grounding. ([UI-TARS](https://github.com/bytedance/UI-TARS)) |
| **OS-Atlas-7B / UGround-V1-7B** | 7B | Dedicated GUI **grounding** models (coordinates from a referring expression). Pair with a planner VLM. UGround-V1-7B: ScreenSpot 86.3 avg. OS-Atlas outputs normalised 0–1000 coords. | Use as a grounding sub-module. ([OS-Atlas](https://github.com/OS-Copilot/OS-Atlas), [UGround](https://osu-nlp-group.github.io/UGround/)) |
| **SmolVLM-2.2B** | small | If you want the *same* small model family client & server for a clean story. | Weak grounding; fine for VQA/summaries. |

**Recommended:** **Qwen2.5-VL-7B** as the single server VLM (planner + grounder in one, JSON coords, agent-trained), served via **vLLM** or **Ollama** on one GPU; optionally add **UI-TARS-1.5-7B** or **OS-Atlas-7B** as a grounding fallback for hard clicks. Keep an OpenAI-compatible endpoint so you can swap in a hosted model if the venue GPU dies.

### 6.2 Prior-art frameworks to mirror for the "grounding via structured elements" path
- **OmniParser + any LLM**: screenshot → structured elements w/ numeric IDs + captions → LLM does retrieval-style next-action over IDs. On ScreenSpot, OmniParser+GPT-4o beats specialist fine-tuned models. This is the *lowest-risk* server integration: your server VLM just picks an `id`. ([OmniParser](https://microsoft.github.io/OmniParser/))
- **SeeAct / WebVoyager**: Set-of-Mark (numbered bounding boxes overlaid on the screenshot) + auxiliary text (element text, type, aria-label). WebVoyager's `GPT-4V-Act` JS tool extracts interactables rule-based (no detector model needed) and overlays black numbered boxes → highest success with single black colour. **You can reuse this JS marking tool directly.** ([WebVoyager](https://aclanthology.org/2024.acl-long.371.pdf), [webmarker](https://github.com/reidbarber/webmarker))
- **SeeAct's finding**: raw Set-of-Mark on complex webpage screenshots causes VLM hallucination (wrong box↔label links); grounding is *much* better when you exploit the **HTML element ↔ visual rendering correspondence**. Since you're *in the browser*, you have the DOM — use it. Vision handles what the DOM can't (canvas/img/video/iframe pixels).

---

## 7. Prior-Art Map — What Exists, What to Borrow, How to Stand Out

### 7.1 Privacy-preserving GUI/screen agents (research, 2025–2026) — read these
| Work | Platform | Core idea | Borrow |
|---|---|---|---|
| **GUIGuard** ([arxiv 2601.18842](https://arxiv.org/html/2601.18842v2)) | cross-platform | 3-stage: privacy recognition → protection (mask / semantic replace / latent perturb) → remote task exec; + GUIGuard-Bench (630 trajectories, 13,830 screenshots, region-level privacy labels + task-necessity) | Whole framework shape; **use GUIGuard-Bench for your eval numbers**; high-contrast mask + marker rule; cross-step replacement memory |
| **"Anonymization-Enhanced… Available but Invisible"** ([arxiv 2602.10139](https://arxiv.org/html/2602.10139v3), [code](https://github.com/one-step-beh1nd/gui_privacy_protection)) | mobile | 4 components: PII Detector, UI Transformer (type-preserving pseudonymisation), Secure Interaction Proxy, local Privacy Gatekeeper; session mapping table; only `type` args carry placeholders | Command grammar; placeholder format `PHONE_NUMBER#a1b2c`; magenta overlay + scaled placeholder text; EasyOCR+GLiNER+regex recipe; `cloud_agent_compute_with_tokens` (local model vets whether a cloud request over real values is justified) |
| **MaskClaw** ([arxiv 2605.28646](https://arxiv.org/pdf/2605.28646v2/__stdout.txt), [code](https://github.com/Theodora-Y/MaskClaw)) | edge | Per-user **policy memory**; decide **Allow / Mask / Ask** before raw screen leaves; skill-evolution from user corrections; P-GUI-Evo benchmark | "Allow/Mask/Ask" UX; policy rules keyed on app + persona + recipient + action; confirmation > masking > allow priority |
| **DualTAP + PrivScreen** ([arxiv 2511.13248](https://arxiv.org/html/2511.13248)) | mobile | Adversarial perturbation that blocks *router* VLM PII extraction but preserves *agent* VLM utility; contrastive-attention U-Net; **PrivScreen** dataset (500+ screenshots, injected PII) | PrivScreen as eval data; the privacy–utility trade-off framing & metrics (leakage rate ↓31.6 pp, task success 80.8% vs 83.6%) |
| **VisShield / OPTIC** ([arxiv 2606.09132](https://arxiv.org/html/2606.09132)) | vision data | Instruction-tune a VLM (Kosmos-2.5) to do *privacy-aware OCR* → bounding boxes for only the sensitive text → mask | If you want one model that both finds and localises PII text |

### 7.2 In-browser redaction tools (open source, ship-ready code to study)
`image-pii-redactor` (npm) · `pii-browser` (npm, GLiNER + de-obfuscation) · `w3pn-anonymizer` (GitHub, YuNet+YOLO+Tesseract, ORT-Web) · `safeclipper` · `mask-before-ai` (ki-sum, MV3 extension intercepting AI uploads) · `Susskind2/Maska` (MediaPipe face blur MV3 extension) · `ScreenMask` (real-time on-screen PII blur w/ Luhn/Verhoeff/PAN) · `brianstm/pii-ka-boo` (detect→placeholder→cloud→restore).

### 7.3 In-browser agent extensions (architecture references)
`nanobrowser` (13k★, MV3, multi-agent Navigator/Planner/Validator, DOM processing from browser-use in TS) · `open-browser-use` (drives your real signed-in Chrome via MV3 + native messaging) · `omnibrowser-agent` (WebLLM planner, heuristic + on-device, safety `safe/review/blocked`) · `gemma-gem` / `EdmondYung/gemma4-browser-extension` / `ToS_Extension` (offscreen doc + WebGPU + tool loop).

### 7.4 Your differentiation (this is what turns YELLOW → GREEN in the room)
1. **First real *browser* implementation** of the research privacy pipeline (the papers are all mobile/Android XML-hierarchy based). Browser gives you the DOM *and* the pixels — exploit both; mobile work has neither cleanly.
2. **Provable non-leakage:** Service-Worker network firewall + airplane-mode demo + a live "outbound traffic monitor" panel showing only the sanitised bytes on the wire (DevTools Network screencast).
3. **Reversible, typed redaction contract** (the manifest) + **local Privacy Gatekeeper** that refuses/asks when the server requests computation over real values → directly answers the "redaction-aware server" ask better than a blurred JPEG.
4. **Honest privacy–utility evaluation** on GUIGuard-Bench / PrivScreen: report leakage rate, task success with vs without redaction, over-masking rate, grounding accuracy delta. Numbers beat vibes with ISRO evaluators.
5. **Policy layer (MaskClaw-style Allow/Mask/Ask)** with a per-site rule memory — shows product thinking, not just a model demo.
6. **Graceful degradation**: WebGPU→WASM fallback, server-down→on-device small-VLM answer, model-not-cached→DOM-only structural redaction. Pre-answers the evaluator's "what happens when X fails" question.
7. **ISRO framing**: sovereign privacy layer for operators of sensitive government dashboards using external AI copilots.

---

## 8. 36-Hour Build Plan (concrete, maps to portal's hour buckets)

### Hours 0–4 — Idea lock + scaffolding
- Roles: (1) extension/WebGPU perception, (2) redaction engine + PII stack, (3) server VLM + protocol, (4) UI + demo + eval harness.
- Repo: MV3 extension (WXT or plain Vite) + `offscreen.html` + content script + Node/Python server (FastAPI) fronting vLLM/Ollama with an OpenAI-compatible route.
- Decide: **Option A perception (detector+OCR)** for the guaranteed path; SmolVLM/FastVLM as stretch.
- Freeze the **redaction manifest schema** (Section 5.3) — both client and server teams code against it immediately.
- Data: assemble a demo corpus — a few real-ish dashboards (a fake ISRO-style ops console with names, station IDs, coords, a login form) + pull **GUIGuard-Bench** / **PrivScreen** screenshots for eval.

### Hours 4–22 — Prototype each layer, integrate by hour ~18
- **Perception:** offscreen doc loads YOLOS/RT-DETR ONNX (WebGPU) + Tesseract.js worker; content script does DOM walk → `{id, bbox, role, text, type, sensitiveFlag}`; screenshot via `chrome.tabs.captureVisibleTab`. Output unified region list.
- **Redaction engine:** fuse DOM + vision + OCR→GLiNER.js + regex/Luhn/Verhoeff; risk-classify; canvas black-box + in-box `[CATEGORY#hash]`; build session mapping table; emit sanitised PNG + manifest. Add the **review overlay** (toggle/add/remove boxes) — great demo, and matches every prior tool.
- **Server:** FastAPI receives PNG+manifest; redaction-aware system prompt; call Qwen2.5-VL-7B; parse to `{action|answer}`; return. Add OS-Atlas/UI-TARS grounding fallback if time.
- **Client executor + Gatekeeper:** resolve placeholders locally; execute click(centroid)/type(real value)/scroll; Gatekeeper prompts user if server asks for raw-value computation.
- **Integrate end-to-end on ONE happy path by hour 18–20.** ("Bugs live at the seams.")

### Hours 22–30 — Integration hardening + explicit edge cases
- Connect every component; test with **messy input** (overlapping boxes, OCR noise, Hindi/regional text, iframe/canvas content, no faces, tiny icons).
- **Explicitly demo & handle (PS calls these out):**
  - **Offline handling:** disconnect after model cache warms → extension still perceives + redacts; Service-Worker firewall ON → prove zero outbound pixel bytes; server-down → on-device fallback answer.
  - **Third-party integration:** clean swap between local vLLM and a hosted OpenAI-compatible endpoint via config.
- WebGPU→WASM fallback path tested on a second machine (integrated GPU).
- Eval harness: run the pipeline over GUIGuard-Bench/PrivScreen subset → compute **PII leakage rate, task success (redacted vs raw), over-masking rate, grounding accuracy**. Put the table in the deck.

### Hours 30–36 — Polish, demo script, Q&A prep
- Demo narrative order (portal's recommended order): **problem → solution → architecture → impact**.
  1. Show a sensitive ISRO-style dashboard; ask the agent a question / give it a task.
  2. Split-screen: raw screen (local) vs **exactly what the server sees** (redacted PNG + manifest JSON scrolling).
  3. DevTools Network tab: only sanitised bytes; then flip **airplane mode** / firewall and show it still redacts.
  4. Server VLM returns an action referencing `PHONE_NUMBER#a1b2c`; client resolves locally and types the real value — *the server never saw it*.
  5. Flash the eval table (leakage ↓, task success ~maintained).
- Rehearse answers to the 5 predicted evaluator questions (Section 2.2).
- Fallbacks: pre-recorded video of the WebGPU path; screenshots of the firewall proof; a "server offline" mode.

---

## 9. Evaluator Q&A — Prepared Answers

| Likely question | Your answer |
|---|---|
| **Where's your data from — real or synthetic?** | Demo uses a purpose-built ISRO-style ops console + public research benchmarks **GUIGuard-Bench (13,830 screenshots, region-level privacy labels)** and **PrivScreen (500+ screenshots with injected PII)** for quantitative eval. No real user PII. |
| **Isn't this level of tech overkill?** | The task is inherently multimodal: pixels carry PII the DOM can't see (canvas, `<img>`, video, iframes, screen-share), and the server model must *reason* over layout. A regex-only or DOM-only filter provably leaks burned-in text and faces; we show that gap in the eval. |
| **What happens when connectivity drops / hardware fails / input missing?** | Three-tier degradation: (1) WebGPU→WASM fallback for perception; (2) server-down → on-device small VLM / structural answer; (3) model-not-cached → DOM-only structural redaction (conservative, high-recall). Firewall mode proves the client is self-sufficient after first load. |
| **Production-scale?** | Perception is per-viewport, ~1–2 s; detector+OCR are O(elements). Server is stateless behind vLLM; mapping table is session-scoped and local (bounded). Redaction is high-recall by design (conservative triggers) — we accept some over-masking to avoid leaks, and measure it. |
| **Who benefits, how do you measure success post-deployment?** | Operators of sensitive gov/enterprise dashboards who want AI copilots without sending screen contents to third parties. Metrics: PII leakage rate (target →0), task success retention (≥90% of unredacted baseline), over-masking rate, user overrides per session, % tasks completed offline. |
| **How is the server "aware of the redaction scheme"?** | It receives a typed **redaction manifest** (categories, placeholders, bbox, value length, risk, task-necessity) + a contract system prompt. It reasons over category/length/position and emits actions by region `id` or placeholder; the client resolves placeholders locally. A local **Privacy Gatekeeper** vets any server request to compute over raw values. |
| **Can PII be recovered from your masks?** | Default is solid black (pixels replaced, irrecoverable from the PNG); pixelate/blur offered only for low-risk "storytelling" regions with a documented reversibility caveat. Canvas re-export also strips EXIF/metadata. |

---

## 10. Risks, Gotchas & Mitigations

- **MV3 service-worker model loading** → use Offscreen Document (Section 4.3). *This is the #1 time-sink; wire it first.*
- **WebGPU absent / adapter null** on venue laptops → feature-detect `requestAdapter()` + `shader-f16`; ship WASM fallback; pre-warm a dummy inference to hide shader compile (1–5 s).
- **First-load model download** 30–60 s → progress bar with real messages; pre-cache before the demo; consider bundling a small model as a web-accessible resource.
- **OCR misses / noise** → fuzzy-match OCR strings to the mapping table; conservative regex/checksum layer; manual review overlay as backstop.
- **Set-of-Mark hallucination** on dense pages (SeeAct finding) → prefer DOM-derived element IDs over pure vision labels where DOM exists; single black colour for marks.
- **Over-masking breaks the task** (GUIGuard) → risk levels + `task_necessary` flag; semantic-replace for medium risk so layout/length survive; measure over-masking rate.
- **Cross-step inconsistency** → persistent session mapping table; same entity → same placeholder across screens.
- **Latency** of in-browser VLM → don't run per-frame; detector+OCR every step, VLM once per task; heavy reasoning stays server-side.
- **Scope creep** → Option A perception is the committed deliverable; small in-browser VLM and adversarial perturbation are clearly-labelled stretch goals.
- **Safari** has no WebGPU → target Chrome/Edge 113+ (PS says "popular browsers"; Chrome+Edge qualifies), mention Firefox/Safari as WASM-fallback / roadmap.

---

## 11. Key Takeaways

1. **Build the "trustworthy local–remote hybrid"** the research literature already validated — but as the **first polished WebGPU browser extension** of it. That framing + a working demo is your GREEN-verdict path.
2. **Architecture = Offscreen-Document WebGPU perception → hybrid DOM+vision redaction engine → redaction-aware open-weight server VLM → local placeholder resolution.** Freeze the **redaction manifest schema** in hour 1.
3. **Perception:** commit to detector (YOLO/RT-DETR/OmniParser-style) + OCR (Tesseract.js/Paddle-wasm) in-browser; SmolVLM-256M / FastVLM-0.5B as a crowd-pleasing stretch.
4. **Redaction:** hybrid detection (DOM flags + faces + OCR→GLiNER.js NER + regex/**Luhn/Verhoeff/PAN** validators), solid-black default with in-box `[CATEGORY#hash]`, session-scoped value⇄placeholder mapping that **never leaves the device**.
5. **Server:** **Qwen2.5-VL-7B** (planner+grounder, JSON coords, agent-trained), OpenAI-compatible endpoint, optional **UI-TARS-1.5-7B / OS-Atlas-7B** grounding fallback; offline-deployable, cloud-hosted during SIH.
6. **Differentiate on proof, not features:** Service-Worker network firewall + airplane-mode demo + outbound-traffic panel + **quantitative privacy–utility eval on GUIGuard-Bench / PrivScreen**.
7. **Pre-load the evaluator answers** (Section 9): data provenance, graceful degradation, the manifest contract, mask irreversibility, ISRO impact + metrics.

---

## 12. Sources

**In-browser inference / WebGPU**
1. [Running models on WebGPU — Transformers.js docs](https://huggingface.co/docs/transformers.js/en/guides/webgpu) — `device:'webgpu'`, feature flags, ~70% global support.
2. [Transformers.js V4 PR #1382](https://github.com/xenova/transformers.js/pull/1382) — native WebGPU EP default, new models.
3. [WebGPU vs WebASM: Browser Inference Benchmarks — SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/) — 10–15× WebGPU advantage for generation; WASM wins tiny single-pass.
4. [Run AI Models in the Browser with Transformers.js & WebGPU — Codersarts](https://www.codersarts.com/post/how-to-run-ai-models-directly-in-the-browser-with-transformers-js-and-webgpu) — full stack, Web Worker, Cache API.
5. [Optimizing Transformers.js for Production — SitePoint](https://www.sitepoint.com/optimizing-transformers-js-production/) — COOP/COEP, caching, memory.
6. [Transformers.js v4 WebGPU tutorial — Vadim Alakhverdov](https://vadimall.com/posts/transformers-js-v4-webgpu-browser-ai-typescript) — real tok/s numbers, fallback strategy.

**Small VLMs / on-device**
7. [SmolVLM paper (arxiv 2504.05299)](https://arxiv.org/html/2504.05299) — 256M <1 GB GPU, ~80 tok/s in-browser on M4 Max.
8. [SmolVLM-256M WebGPU example — HF](https://github.com/huggingface/transformers.js-examples/tree/main/smolvlm-webgpu) + [pyimagesearch walkthrough](https://pyimagesearch.com/2025/10/20/running-smolvlm-locally-in-your-browser-with-transformers-js/).
9. [Real-Time Video Captioning in the Browser with FastVLM — AI-Engineer](https://www.ai-engineer.io/tutorials/video-a11y-captions-in-the-browser) — `onnx-community/FastVLM-0.5B-ONNX`, dtype config.
10. [FastVLM WebGPU playground](https://fastvlm.net/demo) — 85× faster TTFT vs LLaVA-OneVision-0.5B.
11. [Best Local Vision-Language Models for Offline AI — Roboflow](https://blog.roboflow.com/local-vision-language-models/) — Qwen2.5-VL, MiniCPM-V 2.6, SmolVLM2, InternVL comparison.
12. [VLMs (Better, faster, stronger) — Hugging Face](https://huggingface.co/blog/vlms-2025) — localization/agent model landscape (Qwen2.5-VL, Molmo, UI-TARS, MAGMA).

**Server VLMs**
13. [Qwen2.5-VL Technical Report (arxiv 2502.13923)](https://arxiv.org/pdf/2502.13923) — box+point grounding, UI elements as objects, agent benches.
14. [Qwen2.5-VL-3B-Instruct card](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct) — ScreenSpot 55.5 / ScreenSpot-Pro 23.9, AndroidWorld 90.8.
15. [InternVL3 blog](https://internvl.github.io/blog/2025-04-11-InternVL-3.0/) — native multimodal pre-training, GUI agents, 1B–78B.
16. [MiniCPM-V repo](https://github.com/qyc-98/MiniCPM-V) — 2.6 (8B), SOTA OCRBench, llama.cpp/ollama, iPad real-time.

**GUI grounding / screen parsing**
17. [OmniParser V2 — Microsoft Research](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/) + [repo](https://github.com/microsoft/OmniParser) — screenshot → structured elements + IDs + captions; YOLOv8/Florence-2.
18. [SeeAct: GPT-4V is a Generalist Web Agent, if Grounded (arxiv 2401.01614)](https://arxiv.org/html/2401.01614) — grounding via element attributes / textual choice / image annotation; SoM hallucination on webpages.
19. [WebVoyager (ACL 2024)](https://aclanthology.org/2024.acl-long.371.pdf) + [repo](https://github.com/MinorJerry/WebVoyager) — Set-of-Mark on screenshots, rule-based `GPT-4V-Act` interactable extractor.
20. [WebMarker](https://github.com/reidbarber/webmarker) — JS library for Set-of-Mark in the browser.
21. [UGround / SeeAct-V (arxiv 2410.05243)](https://arxiv.org/html/2410.05243v2) + [homepage](https://osu-nlp-group.github.io/UGround/) — vision-only grounding, 10M elements, ScreenSpot 86.3 (7B).
22. [OS-Atlas (ICLR 2025)](https://github.com/OS-Copilot/OS-Atlas) — cross-platform grounding, 13M elements, 0–1000 normalised coords.
23. [ScreenSpot-Pro (arxiv 2504.07981)](https://arxiv.org/html/2504.07981) — high-res pro GUI grounding; best base model 18.9%; ScreenSeekeR search → 48.1%.
24. [UI-TARS](https://github.com/bytedance/UI-TARS) — UI-TARS-1.5-7B, ScreenSpot-V2 94.2, ScreenSpot-Pro 49.6/61.6.

**Chrome MV3 / extension architecture**
25. [chrome.offscreen API docs](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — hidden DOM doc, one per extension, reasons/justification.
26. [Why I moved my Transformers.js pipeline to an Offscreen Document — dev.to](https://dev.to/sathiyasenpai/why-i-moved-my-transformersjs-pipeline-out-of-the-chrome-mv3-service-worker-and-into-an-offscreen-1kk4) — MV3 SW ephemerality, CSP, WASM issues.
27. [gemma4-browser-extension](https://github.com/EdmondYung/gemma4-browser-extension) & [gemma-gem](https://github.com/kessler/gemma-gem) — offscreen(WebGPU)+SW(router)+content-script(DOM tools) pattern.
28. [ToS_Extension](https://github.com/tushar-cmd27/tos_extension) — Llama-3.2-1B via WebGPU, offscreen doc, content extractor.
29. [Nanobrowser](https://github.com/nanobrowser/nanobrowser) — MV3 multi-agent (Navigator/Planner/Validator), browser-use DOM processing in TS.
30. [open-browser-use](https://github.com/open-browser-use/open-browser-use) & [omnibrowser-agent](https://github.com/akshayram1/omnibrowser-agent) — local-first browser agents; WebLLM planner + safety tiers.

**Privacy-preserving screen/GUI agents (core prior art)**
31. [GUIGuard: Toward a General Framework for Privacy-Preserving GUI Agents (arxiv 2601.18842)](https://arxiv.org/html/2601.18842v2) — 3-stage pipeline; GUIGuard-Bench; high-contrast mask rule; semantic replace; cross-step memory.
32. [Anonymization-Enhanced Privacy Protection for Mobile GUI Agents: "Available but Invisible" (arxiv 2602.10139)](https://arxiv.org/html/2602.10139v3) + [code](https://github.com/one-step-beh1nd/gui_privacy_protection) — PII Detector / UI Transformer / Secure Interaction Proxy / Privacy Gatekeeper; `TYPE#hash` placeholders; EasyOCR+GLiNER+regex.
33. [MaskClaw: Edge-Side Personalized Privacy Arbitration for GUI Agents (arxiv 2605.28646)](https://arxiv.org/pdf/2605.28646v2/__stdout.txt) — Allow/Mask/Ask, policy memory, skill evolution, P-GUI-Evo.
34. [DualTAP: Dual-Task Adversarial Protector for Mobile MLLM Agents (arxiv 2511.13248)](https://arxiv.org/html/2511.13248) + [repo](https://github.com/fyzhang1/DualTAP) — adversarial perturbation, PrivScreen dataset, privacy–utility metrics.
35. [VLM Helps Private Information De-Identification in Vision Data / VisShield-OPTIC (arxiv 2606.09132)](https://arxiv.org/html/2606.09132) — privacy-aware OCR → bbox → mask.

**In-browser PII redaction tooling**
36. [image-pii-redactor (npm)](https://registry.npmjs.org/image-pii-redactor) — Tesseract.js + `onnx-community/multilang-pii-ner-ONNX` + regex + SW firewall.
37. [pii-browser (npm)](https://www.npmjs.com/package/pii-browser) — Rust/WASM + GLiNER + placeholder catalog + de-obfuscation of LLM response.
38. [web3privacy/w3pn-anonymizer](https://github.com/web3privacy/w3pn-anonymizer) — YuNet faces + YOLO + Tesseract, ORT-Web, 10 redaction effects, fully local.
39. [afk-surf/safeclipper](https://github.com/afk-surf/safeclipper) — OCR → OpenAI Privacy-Filter q4 ONNX → mask before leaving device.
40. [ki-sum/mask-before-ai](https://github.com/ki-sum/mask-before-ai) & [Susskind2/Maska](https://github.com/Susskind2/Maska) — MV3 extensions intercepting AI uploads / MediaPipe face blur.
41. [ScreenMask](https://getscreenmask.com/) — real-time on-screen PII blur, Luhn/Verhoeff/PAN validation, 100% local.
42. [brianstm/pii-ka-boo](https://github.com/brianstm/pii-ka-boo) — detect → `[NAME_1]` placeholder → cloud AI → local restore (hackathon pattern).

**PII detection libs / OCR**
43. [GLiNER.js](https://github.com/Ingvarstep/GLiNER.js/) — TS GLiNER inference, WebGPU/WASM, real-time PII.
44. [PaddleOCR vs Tesseract vs transformer OCR — Loft Tools](https://lofttools.com/blog/on-device-ocr-reviewed/) — on-device OCR engines, WASM vs ORT-Web, quantisation.
45. [MediaPipe Face Detector for Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js) — BlazeFace, IMAGE/VIDEO modes, run in worker.
46. [TF.js vs Transformers.js vs ONNX Runtime Web for Video AI in 2026 — Medium](https://medium.com/@muh.atta/tensorflow-js-cad9c589f31c) — backend selection, WebNN/NPU, FPS benchmarks.

## Methodology
Ran 9 semantic web searches (Exa) across 6 sub-questions — in-browser WebGPU inference & benchmarks; browser-agent visual grounding (SeeAct/WebVoyager/OmniParser/Set-of-Mark); client-side PII/face redaction tools; privacy-preserving GUI-agent research (anonymisation, reversible mapping, adversarial); MV3 + offscreen-document + WebGPU extension architecture; open-weight server VLMs & GUI grounders. Analysed 46 sources (arXiv papers, official docs, model cards, open-source repos, engineering write-ups), prioritising 2025–2026 material. Gaps: no source shows this exact pipeline shipped as a browser extension (that's the opportunity); in-browser latency numbers are hardware-dependent ballparks; ISRO's internal evaluation rubric is inferred from the portal summary, not official.
