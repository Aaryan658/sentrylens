# SentryLens — Design Spec

*SIH26171 (ISRO) — On-Device Visual Perception for Light-weight Browser Agents*
*Date: 2026-09-09 · Status: approved for planning · Companion: [SIH26171_Deep_Research_Report.md](../../../SIH26171_Deep_Research_Report.md)*

---

## 1. Purpose & Success Criteria

**Purpose.** A browser extension that lets a user delegate a web task to an AI agent **without exposing screen contents (faces, passwords, PII) to the remote model**. Perception and redaction happen on-device via WebGPU; only an anonymised screenshot + a typed redaction manifest cross the network; the remote open-weight VLM reasons over the manifest and returns actions; the client resolves anonymised placeholders locally and executes them.

**MVP success criteria (all must hold for the demo):**
1. User types a task in the side panel; the agent completes a ≥3-step task on a local demo page end-to-end (perceive → redact → server action → execute → loop → done).
2. The "what the server saw" split view shows the redacted screenshot + manifest JSON; **no raw PII value** appears in the payload (verified by a test).
3. **Firewall toggle ON** → all non-allowlisted network requests blocked at the service worker; perception + redaction still run (proving on-device self-sufficiency after model cache warm).
4. WebGPU path runs the element detector + SmolVLM; on a machine without WebGPU it falls back to WASM (detector) and skips the in-browser VLM with a visible notice — no crash.
5. A planted PII fixture set (fake names, phones, PAN, Aadhaar, card numbers, a face image) is 100% masked and 100% present in the mapping table.

**Explicit non-goals for MVP** (post-MVP, tracked in the research report): multi-tab orchestration; semantic-replacement & adversarial-perturbation redaction; MaskClaw-style policy memory / Allow-Mask-Ask; Firefox/Safari; the quantitative GUIGuard-Bench / PrivScreen eval harness; auth-gated real sites (demo uses a local page).

---

## 2. Stack Decisions (locked)

| Concern | Choice | Rationale |
|---|---|---|
| Extension framework | **WXT** (Vite-based, MV3) + **TypeScript** | Handles MV3 manifest, offscreen, HMR, content-script/background/sidepanel entrypoints; least boilerplate. |
| Side-panel UI | **React 18** + minimal CSS (no component lib) | Fast to build the step log + split view; keep bundle small. |
| In-browser ML | **@huggingface/transformers** (v4) + **onnxruntime-web** | v4 = default WebGPU EP; ORT-Web for the custom detector with WASM fallback. |
| OCR | **tesseract.js** v5 (worker, eng + Devanagari traineddata) | Per-word bounding boxes; 100+ langs; WASM, ubiquitous. |
| On-device NER | **GLiNER** via **@huggingface/transformers** token-classification pipeline (`onnx-community/gliner_multi_pii-v1` or `onnx-community/multilang-pii-ner-ONNX`) | Zero-shot PII labels; WebGPU/WASM. |
| Faces | **@mediapipe/tasks-vision** FaceDetector (BlazeFace) | Optimised, small, runs in worker. |
| Element detector | ONNX model in `offscreen` — start with **`onnx-community/yolos-tiny`** (COCO: person/tv/laptop/phone) for the vision demo; DOM walk is the primary element source. Detector slot is swappable to an OmniParser-style icon detector post-MVP. | Keeps the "vision model reads the screen" requirement satisfied with a small, known-good ONNX model. |
| In-browser VLM | **SmolVLM-256M-Instruct** (`HuggingFaceTB/SmolVLM-256M-Instruct`) via transformers.js, WebGPU, `dtype` fp32→q4f16 | <1 GB GPU RAM; produces a one-line screen summary per step. FastVLM-0.5B is a drop-in alt. |
| Contracts | **zod** schemas in `shared/` | Runtime validation at every boundary; single source of truth. |
| Server | **Node + Express** (~1 file, TypeScript, `tsx` runtime) | One language across the project; thin proxy holding the API key. |
| Server model | **provider-agnostic OpenAI-compatible client**; default **OpenRouter `qwen/qwen2.5-vl-32b-instruct:free`**; `MOCK=1` → rule-based responder; local Ollama `qwen2.5-vl` documented as the "offline deployment" story | PS allows cloud-hosted open-weight during SIH; Qwen2.5-VL has native coordinate grounding. |
| Package manager | **pnpm** workspace (`extension/`, `server/`, `shared/`) | Monorepo; `shared` imported by both. |
| Tests | **vitest** (unit + node integration); manual E2E against `demo/demo-dashboard.html` | |

---

## 3. Repository Layout

```
sentrylens/
├─ pnpm-workspace.yaml
├─ package.json                      # root: scripts (dev, build, test, server)
├─ shared/
│  ├─ package.json
│  └─ src/
│     ├─ contracts.ts                # zod: RegionList, RedactionManifest, AgentAction, ServerRequest/Response
│     ├─ categories.ts               # PII category enum + risk defaults + redaction style defaults
│     └─ index.ts
├─ extension/
│  ├─ wxt.config.ts
│  ├─ package.json
│  ├─ entrypoints/
│  │  ├─ background.ts               # service worker: message router, captureVisibleTab, network firewall, offscreen lifecycle
│  │  ├─ content.ts                  # DOM walk → RegionList; execute click/type/scroll; on-page overlay
│  │  ├─ offscreen/
│  │  │  ├─ index.html
│  │  │  └─ main.ts                  # model registry (detector, SmolVLM, GLiNER, OCR, face); runPerception()
│  │  └─ sidepanel/
│  │     ├─ index.html
│  │     ├─ App.tsx                  # task input, step log, split view, firewall toggle, review overlay
│  │     └─ main.tsx
│  ├─ src/
│  │  ├─ perception/
│  │  │  ├─ detector.ts              # ORT-Web YOLOS-tiny, WebGPU→WASM
│  │  │  ├─ ocr.ts                   # tesseract worker wrapper
│  │  │  ├─ ner.ts                   # GLiNER pipeline wrapper
│  │  │  ├─ faces.ts                 # MediaPipe FaceDetector wrapper
│  │  │  └─ vlm.ts                   # SmolVLM summary
│  │  ├─ redaction/
│  │  │  ├─ fuse.ts                  # merge DOM + detector + OCR-spans + NER + faces → SensitiveRegion[]
│  │  │  ├─ validators.ts            # regex + Luhn (cards) + Verhoeff (Aadhaar) + PAN + IFSC + email/phone/IP
│  │  │  ├─ classify.ts              # risk level + task_necessary heuristic
│  │  │  ├─ mask.ts                  # canvas: blackbox + in-box [CATEGORY#hash] label; returns sanitized PNG
│  │  │  ├─ mapping.ts               # session value ⇄ PLACEHOLDER#hash table (in-memory, offscreen only)
│  │  │  └─ manifest.ts              # assemble RedactionManifest
│  │  ├─ agent/
│  │  │  ├─ loop.ts                  # orchestrates: perceive → redact → server → resolve → execute → repeat
│  │  │  └─ resolve.ts              # placeholder → real value substitution for `type` actions
│  │  ├─ messaging.ts               # typed chrome.runtime message bus (zod-validated)
│  │  └─ firewall.ts                # allowlist + fetch/webRequest gate
│  └─ public/models/                 # (optional) self-hosted onnx/wasm/traineddata for offline-first
├─ server/
│  ├─ package.json
│  └─ src/
│     ├─ index.ts                    # Express: POST /agent/step  → validate → LLM/mock → AgentAction
│     ├─ prompt.ts                   # redaction-aware system prompt builder
│     ├─ providers/
│     │  ├─ openai-compatible.ts     # fetch wrapper (OpenRouter / Groq / Ollama / hosted)
│     │  └─ mock.ts                  # rule-based responder for offline dev
│     └─ parse.ts                    # LLM text/JSON → validated AgentAction (with repair retry)
├─ demo/
│  └─ demo-dashboard.html            # fake ISRO ops console: login form + PII table + buttons
└─ docs/ …
```

---

## 4. Contracts (`shared/src/contracts.ts`)

All cross-boundary messages are zod-validated. Shapes (fields, not final code):

```ts
// A DOM/vision element the agent can reason about or act on.
Region = {
  id: number;                       // stable within a step
  bbox: [x: number, y: number, w: number, h: number];  // CSS px, viewport-relative
  source: "dom" | "detector";
  role: string;                     // "button" | "link" | "textbox" | "image" | ...
  name: string;                     // accessible name / visible text (may be redacted downstream)
  domType?: string;                 // input type, tag
  interactable: boolean;
}
RegionList = { url: string; viewport: {w:number;h:number;dpr:number}; regions: Region[]; screenSummary?: string }

PiiCategory = "PERSON_NAME" | "EMAIL" | "PHONE_NUMBER" | "ADDRESS" | "DOB" |
  "CREDIT_CARD" | "AADHAAR" | "PAN" | "IFSC" | "BANK_ACCOUNT" | "PASSWORD" |
  "API_KEY" | "IP_ADDRESS" | "FACE" | "GOV_ID" | "OTHER"

RedactedRegion = {
  id: number;
  bbox: [number,number,number,number];
  kind: "redacted";
  category: PiiCategory;
  placeholder: string;              // e.g. "PHONE_NUMBER#a1b2c"
  value_len: number | null;         // char length (null for FACE)
  risk: "high" | "medium" | "low";
  style: "blackbox" | "pixelate" | "blur";
  task_necessary: boolean;
  detected_by: ("dom"|"ocr+ner"|"regex"|"face")[];
}
ElementRegion = { id:number; bbox:[...]; kind:"element"; role:string; text:string; interactable:boolean }

RedactionManifest = {
  schema: "sentrylens-redaction/1.0";
  image: { w:number; h:number; dpr:number };
  regions: (ElementRegion | RedactedRegion)[];
  notes: string;                    // the contract sentence sent to the model
}

AgentAction =
  | { type: "click";  target_id: number; thought: string }
  | { type: "type";   target_id: number; value: string; thought: string }   // value MAY contain placeholders
  | { type: "scroll"; direction: "up"|"down"; amount?: number; thought: string }
  | { type: "wait";   ms: number; thought: string }
  | { type: "done";   answer: string; thought: string }
  | { type: "fail";   reason: string; thought: string }

ServerRequest  = { task: string; image_b64: string; manifest: RedactionManifest; history: StepRecord[] }
ServerResponse = { action: AgentAction; raw?: string }
StepRecord     = { action: AgentAction; observation: string }   // observation is redacted/summarised
```

**Invariants (enforced by tests):**
- `RedactedRegion.placeholder` is deterministic: `${category}#${base32(hmac(sessionKey, normalisedValue)).slice(0,5)}`. Same value → same placeholder within a session.
- The mapping table (`value → placeholder`) and its inverse **never** appear in `ServerRequest`, logs, or `chrome.storage`.
- Only `AgentAction.type === "type"` may carry placeholders in `value`. `click`/`scroll` reference `target_id` only.
- Every `RedactedRegion.bbox` in the manifest corresponds to actually-painted mask pixels in `image_b64`.

---

## 5. Per-Step Data Flow

```
sidepanel: user submits task
  └─▶ background.agentLoop.start(task)
        │
        ├─ background → content: "collectRegions"
        │     content walks DOM (visible, interactable + text nodes), assigns ids,
        │     flags sensitive DOM (input[type=password], autocomplete=cc-*|tel|email,
        │     aria-label ~ PII, [data-sensitive]) → RegionList
        │
        ├─ background: chrome.tabs.captureVisibleTab → PNG (dataURL)
        │
        ├─ background → offscreen: { png, regionList }  "runPerception"
        │     offscreen:
        │       detector.run(png)      → detector Regions (person/screen/etc.)
        │       ocr.run(png)           → words + bboxes
        │       ner.run(ocrText)       → PII spans → map back to word bboxes
        │       faces.run(png)         → face bboxes
        │       vlm.summary(png)       → screenSummary (best-effort; skip if no WebGPU)
        │       fuse(regionList, detector, ocrSpans, ner, faces) → SensitiveRegion[]
        │       validators over OCR text + DOM text → structured PII (Luhn/Verhoeff/PAN/…)
        │       classify → risk + task_necessary
        │       mask(png, sensitiveRegions) → sanitizedPng
        │       mapping.upsert(value → placeholder)   [stays here]
        │       manifest.build(elements + redactedRegions) → RedactionManifest
        │     returns { sanitizedPng, manifest, screenSummary }   (NO mapping)
        │
        ├─ background → server POST /agent/step { task, image_b64: sanitizedPng, manifest, history }
        │     server: validate → prompt.build(manifest) → provider.chat(...) → parse → AgentAction
        │     returns ServerResponse
        │
        ├─ background → offscreen: resolve(action)   // placeholder → real value (type actions only)
        │     resolve uses mapping table; returns AgentAction with concrete value
        │
        ├─ background → content: execute(resolvedAction)
        │     content: click(centroid of bbox) | type(real value via input events) |
        │              scroll | wait ; returns { ok, observation }
        │
        └─ history.push({ action, observation });  if action.type in {done,fail} stop; else loop
             sidepanel receives step events → renders step log + split view
```

**Step budget:** default max 12 steps, configurable; loop stops on `done`/`fail`/budget.

---

## 6. Redaction Engine Detail

**Detection fusion (`fuse.ts`)** — produce one `SensitiveRegion[]`, deduped by IoU > 0.6:
1. **DOM signals (highest precision):** `input[type=password]` → `PASSWORD` high; `autocomplete` tokens → category; `type=email|tel` → `EMAIL|PHONE_NUMBER`; label/aria text matched against category keywords; `[data-sensitive]` → `OTHER` high.
2. **Faces:** every face bbox → `FACE` medium (high if page flagged sensitive).
3. **OCR + GLiNER:** OCR words → text; GLiNER over concatenated text with PII label set; map entity char-spans back to the union of covering word bboxes.
4. **Validators over all visible text (OCR + DOM):** regex + checksum. `CREDIT_CARD` (Luhn), `AADHAAR` (12-digit + Verhoeff), `PAN` (`[A-Z]{5}[0-9]{4}[A-Z]`), `IFSC` (`[A-Z]{4}0[A-Z0-9]{6}`), `EMAIL`, `PHONE_NUMBER` (IN + intl), `IP_ADDRESS`, `API_KEY` (high-entropy / known prefixes). Checksum-valid matches → high confidence, low false-positive.
5. Merge: a region's category = highest-precedence source; `detected_by` accumulates all; confidence = max.

**Classification (`classify.ts`):**
- risk: `PASSWORD|CREDIT_CARD|AADHAAR|PAN|GOV_ID|API_KEY` → high; `PERSON_NAME|EMAIL|PHONE_NUMBER|ADDRESS|DOB|BANK_ACCOUNT|FACE|IFSC` → medium; `IP_ADDRESS|OTHER` → low.
- `task_necessary`: true if the region overlaps an interactable element the task text plausibly refers to (keyword overlap between task and the element's accessible name), else false. High-risk is always masked regardless; `task_necessary` is a hint the server may use.

**Masking (`mask.ts`):** default `blackbox` — fill bbox with `#0A0A0A`, then draw `[CATEGORY#hash]` centred, font auto-scaled to fit (min 9px, else just the category). `pixelate`/`blur` available via config for `low` risk only. Canvas re-export as PNG (strips metadata). Contrast guaranteed vs local pixels (sample mean luminance, pick black or white text).

**Mapping (`mapping.ts`):** `Map<placeholder, {value, category}>` + `Map<normValue, placeholder>`. `sessionKey` = random 32 bytes per agent run. `normValue` = trim + collapse whitespace + lowercase for names/emails; digits-only for numbers. OCR-noisy lookups: Levenshtein ≤ 2 against existing `normValue` keys reuse the placeholder. Cleared on run end.

**Offline / degraded path:** if models aren't cached or firewall blocks their fetch and they're not local: skip detector/VLM/GLiNER; run DOM signals + validators + faces (MediaPipe is small/bundled). Manifest `notes` gains `"degraded: structural redaction only"`.

---

## 7. Server

**`POST /agent/step`** — body `ServerRequest`, response `ServerResponse`.

**System prompt (`prompt.ts`)** conveys the contract:
> You are a web agent operating on an **anonymised** screenshot. Regions labelled `CATEGORY#hash` are redacted PII — you can see their category, position and value length but not the value. Refer to elements by their numeric `id` from the manifest. Emit exactly one JSON action: `click`/`type`/`scroll`/`wait`/`done`/`fail`. For `type`, if the value should be a redacted item, output its placeholder verbatim (e.g. `PHONE_NUMBER#a1b2c`); the client will substitute the real value locally. Never guess a redacted value. …
Plus: the manifest JSON, the task, and compact history.

**Provider abstraction (`providers/openai-compatible.ts`):** `chat({system, user, image_b64, model, baseURL, apiKey})` → text. Config via env: `PROVIDER=openrouter|groq|ollama|openai`, `MODEL`, `BASE_URL`, `API_KEY`. Default OpenRouter + `qwen/qwen2.5-vl-32b-instruct:free`.

**`mock.ts`:** deterministic rule-based — inspects task keywords + manifest element names to pick a plausible `click`/`type`/`done`. Enables full offline E2E and CI.

**`parse.ts`:** extract JSON (fenced or bare) → zod `AgentAction`. On failure, one repair round-trip ("your last output was invalid JSON, resend only the action object"). Second failure → `{type:"fail", reason:"unparseable model output"}`.

---

## 8. Firewall (proof of non-leakage)

- `firewall.ts` maintains an **allowlist**: the model/CDN hosts (`huggingface.co`, `cdn.jsdelivr.net`, `storage.googleapis.com` for mediapipe, tesseract CDN) and the SentryLens server origin.
- Toggle in side panel. When **ON**: `chrome.declarativeNetRequest` (dynamic rules) blocks every request whose initiator is the extension and whose host is not allowlisted; additionally the side panel shows an **outbound log** (host, bytes, purpose) for every request the extension makes.
- Demo move: warm the model cache, flip firewall ON, disconnect Wi-Fi if desired, run a task → perception + redaction still work; the only outbound bytes are `POST /agent/step` with the sanitised payload, shown in the log.
- Post-MVP: a stricter "airgap" mode that also blocks the server call and answers from the in-browser SmolVLM only.

---

## 9. Error Handling (summary table)

| Failure | Behaviour |
|---|---|
| `navigator.gpu` missing / adapter null | detector + GLiNER → ORT-Web WASM; SmolVLM skipped, side panel notice "in-browser VLM unavailable (no WebGPU)". |
| Model fetch fails (offline, not cached) | degraded structural redaction (§6); notice; continue. |
| OCR/NER throws on a frame | log, treat as "no spans this step"; DOM + validators still run. |
| Server 4xx/5xx / rate-limited | retry once after 2 s; then surface error + one-click "switch to mock mode". |
| Model output unparseable | repair round-trip, then `fail` action. |
| `target_id` not in current RegionList | push observation "element N not found" back to model; after 2 such in a row → `fail`. |
| Action execution throws (element detached) | re-perceive and retry the same step once; then `fail`. |
| Step budget exceeded | stop with `fail` "step budget exceeded"; side panel shows full history. |
| Firewall ON blocks a needed host | request appears in outbound log as BLOCKED; pipeline degrades per above (never hangs). |

---

## 10. Testing

**Unit (vitest):**
- `shared/contracts` — every schema: valid sample parses, malformed rejected; `AgentAction` discriminated union.
- `redaction/validators` — Luhn (valid/invalid cards), Verhoeff (valid/invalid Aadhaar), PAN/IFSC regex, email/phone/IP; false-positive guards (random 16-digit non-card, 12-digit non-Aadhaar).
- `redaction/mapping` — determinism (same value→same placeholder), inverse lookup, Levenshtein reuse, `sessionKey` isolation, `clear()`.
- `redaction/fuse` — synthetic inputs: DOM says password + OCR/NER says name + face → 3 deduped regions, correct categories/risk; IoU dedupe.
- `redaction/manifest` — no raw value in output; every `RedactedRegion` has a placeholder; `notes` present.
- `server/parse` — fenced JSON, bare JSON, prose+JSON, garbage → repair path.

**Integration (vitest, node):**
- `server` in `MOCK=1`: POST a fixture `ServerRequest` (image + manifest with a phone placeholder + a "Login" button element) → assert a valid `AgentAction` referencing a real `target_id`.
- Redaction pipeline over 5 fixture PNGs (`demo/fixtures/*.png` with planted synthetic PII + one face) → assert: every planted entity masked (pixel check in bbox), every planted entity in mapping table, zero raw values in serialised manifest.

**Manual E2E (checklist in `docs/DEMO.md`):**
- Load `demo/demo-dashboard.html`; task: "log in as the operator and open the telemetry report for station VSSC-03".
- Verify: split view shows redacted name/phone/PAN in the PII table + masked password field; server action `type` uses `PASSWORD#…`; client types the real fixture value; task reaches `done`.
- Toggle firewall ON, repeat; confirm outbound log shows only the server call.
- Run on a second machine / disable WebGPU flag; confirm graceful degradation.

**Fixtures use only synthetic data** — fake names, `+91 90000 00000`-style numbers, `ABCDE1234F`-style PAN, test card `4111 1111 1111 1111`, a CC0 face image. No real PII anywhere in the repo.

---

## 11. Build Order (for the implementation plan)

1. Monorepo scaffold (pnpm workspace, WXT init, tsconfig, vitest) + `shared/contracts.ts` + `shared/categories.ts` with tests.
2. `demo/demo-dashboard.html` + `demo/fixtures/` (synthetic PII screenshots).
3. `redaction/validators.ts` + `redaction/mapping.ts` + tests (pure, no browser).
4. `server/` (Express + mock provider + parse) + integration test in `MOCK=1`.
5. Extension shell: background router, content-script DOM walk → `RegionList`, side-panel skeleton, typed messaging.
6. `offscreen` model registry: OCR + GLiNER + MediaPipe faces + ORT detector (WebGPU→WASM); `runPerception` returns fused `SensitiveRegion[]` (no VLM yet).
7. `redaction/fuse` + `classify` + `mask` + `manifest` wired into `offscreen`; pipeline test over fixtures.
8. `agent/loop` + `agent/resolve` + `content.execute`; end-to-end against `demo-dashboard.html` in `MOCK=1`.
9. Swap mock → OpenRouter provider; redaction-aware prompt; real multi-step run.
10. `firewall.ts` + side-panel firewall toggle + outbound log; "what the server saw" split view; step log polish.
11. `vlm.ts` (SmolVLM summary) added to `runPerception`; feeds `screenSummary` into history.
12. `docs/DEMO.md` script; second-machine degradation pass; README.

---

## 12. Open Questions / Assumptions

- **A1:** OpenRouter free-tier rate limits are adequate for a live demo (~1 call/step, ~12 steps). Mitigation: mock mode + local Ollama documented.
- **A2:** `chrome.tabs.captureVisibleTab` resolution (device pixels) is reconciled with content-script CSS-px bboxes via `dpr` in every transform. All bbox math goes through one `viewportToImage(bbox, dpr)` helper.
- **A3:** SmolVLM-256M summary quality is "nice-to-have" narration, not on the critical path — acceptable if weak.
- **A4:** Demo target is the local `demo-dashboard.html`; real cross-site auth flows are post-MVP.
- **Q1 (defer):** self-host model weights in `extension/public/models/` for true first-run-offline, or accept a one-time CDN download? — default: CDN download + cache; self-host is a documented flag.
