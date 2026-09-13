# SentryLens — demo & verification walkthrough

Everything that can be checked without a browser is already covered by
`pnpm test` (60 unit tests) and `pnpm --filter @sentrylens/extension e2e`
(headless real-model run). This file is the **Chrome** part — the MV3 shell,
WebGPU, mediapipe faces, SmolVLM, and the on-canvas masking.

## 0. Prereqs

- **Chrome or Edge 121+** with WebGPU. Open `chrome://gpu` — "WebGPU" should say
  *Hardware accelerated*. If not, everything still runs on WASM (slower, SmolVLM
  summary is skipped and a "degraded" notice shows).
- Node 20+ and pnpm 11 (`corepack enable` if needed).

## 1. Build everything

```bash
pnpm install
pnpm --filter @sentrylens/extension build          # -> extension/.output/chrome-mv3
```

## 2. Start the server (mock mode)

```bash
cp server/.env.example server/.env     # ships with MOCK=1
pnpm --filter @sentrylens/server start  # "sentrylens server on :8787 (mock=true)"
```

The server reads `server/.env` on startup (no shell `export` needed — real env
vars still win). It **must** print `(mock=true)`. If it prints `(mock=false)` or
`EADDRINUSE`, a stale server holds the port:

```bash
npx kill-port 8787
```

## 3. Serve the demo page

New terminal, from the repo root:

```bash
npx serve demo              # note the printed URL, e.g. http://localhost:3000
```

Open that URL in Chrome. It must be `http(s)://…`, not a `file://` path, or the
content script will not inject.

## 4. Load the extension

1. `chrome://extensions` → toggle **Developer mode** (top right).
2. **Load unpacked** → select `extension/.output/chrome-mv3`.
3. Pin **SentryLens** to the toolbar.

The service worker (re)injects the content script into the target tab on each
run, so you do **not** need to hand-reload the demo tab after reloading the
extension. It also skips `chrome://` / devtools tabs and targets the most
recently used normal tab, so the side panel can be docked anywhere.

## 5. Run a task

Click the SentryLens toolbar icon to open the side panel. Keep the default task:

> log in as the operator and open the telemetry report for station VSSC-03

Click **Run task**.

**First run downloads models** (~30–60 s: tesseract eng data, the PII-NER ONNX,
the mediapipe face model, and — WebGPU only — SmolVLM). Watch progress in the
offscreen console: `chrome://extensions` → SentryLens → *Inspect views:
offscreen.html*. Subsequent runs are instant (served from the HTTP cache).

Expected:
- Step cards appear. In mock mode the agent walks the login: **type** the
  operator id → **type** the password (the action's `value` is `PASSWORD#1`, the
  placeholder — the server never sees the real value; the extension substitutes
  it locally before it reaches the page) → **click** Sign in → `done`.
- Each card's **"What the server saw"** shows the **masked** screenshot and the
  manifest JSON. The manifest contains `PASSWORD#…`, `EMAIL#…`, `PHONE_NUMBER#…`,
  `PAN#…`, `AADHAAR#…`, `CREDIT_CARD#…`, `FACE#1` — and **no raw values**.
- The **Network** list shows only `localhost:8787` rows.

## 6. Leak check (the privacy claim, in Chrome)

1. Expand every step's manifest. Use the browser find (Ctrl+F) on the side panel
   for each of: `Menon`, `9000000000`, `ABCDE1234F`, `ops.lead@vssc.test`,
   `4321 5678 9003`, `4111 1111 1111 1111`. **Zero matches** anywhere in the panel.
2. In the offscreen DevTools **Network** tab, confirm the only cross-origin
   requests are model-weight fetches to `huggingface.co` / `cdn.jsdelivr.net` /
   `storage.googleapis.com` — never to the server host with PII in the body.
   Open the `POST localhost:8787/agent/step` request → **Payload** → the
   `image_b64` is the masked PNG and the `manifest` has only placeholders.
3. On the masked screenshot, the PII cells of the duty-roster table are painted
   over (solid `#0A0A0A`, labelled with the placeholder). No original text is
   legible under a mask.

## 7. Firewall proof

1. With models already cached from step 5, tick **Network firewall** in the side
   panel (optionally also turn Wi-Fi off).
2. Run the task again.
3. Expected: perception + redaction still run (models from cache); the side-panel
   Network list still shows only `localhost:8787`; the offscreen Network tab
   shows blocked/failed requests to any non-allowlisted host and **no** successful
   new `huggingface.co` / `jsdelivr` fetches.

## 8. Real VLM (open-weight, remote)

1. Get an OpenRouter key (or any OpenAI-compatible vision endpoint). In
   `server/.env`:

   ```
   MOCK=0
   PROVIDER=openrouter
   BASE_URL=https://openrouter.ai/api/v1
   MODEL=qwen/qwen2.5-vl-32b-instruct:free
   API_KEY=<your key>
   ```

2. Restart the server: `npx kill-port 8787` then
   `pnpm --filter @sentrylens/server start` — it reads `server/.env` and now
   prints `(mock=false)`. (`server/.env` is gitignored; never commit the key.)
3. Re-run the task from the side panel. The VLM now issues real actions: type the
   operator id, type into the password field (a placeholder if it were PII —
   here the demo password is a literal, so a literal is acceptable for the MVP),
   click **Sign in**, click **Open VSSC-03 report**, then `done` once the report
   text is visible.
4. If it loops or misgrounds: lower `CFG.maxSteps` in
   `extension/src/config.ts`, or switch `MODEL` to
   `qwen/qwen2.5-vl-72b-instruct:free`.

You can also sanity-check the redacted request against a real endpoint headlessly:

```bash
# server running with MOCK=0 + a key
E2E_VLM=1 pnpm --filter @sentrylens/extension e2e
```

## Offline deployment (the "final" story)

Run an open-weight VLM locally instead of OpenRouter:

```bash
ollama pull qwen2.5-vl
```

then in `server/.env`: `MOCK=0` `PROVIDER=ollama`
`BASE_URL=http://localhost:11434/v1` `MODEL=qwen2.5-vl` `API_KEY=ollama`.
The client and the whole redaction pipeline are unchanged — only the server's
upstream differs.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Side panel shows nothing | Reload the extension, then reload the demo tab so the content script re-injects. |
| "degraded: structural redaction only" notice | WebGPU/model load failed — check the offscreen console. OCR/NER/faces fall back or skip; DOM-based redaction still runs. |
| Masks are offset from the text | `dpr` mismatch — the manifest `image` and mask bboxes are device px (`viewportToImage` applied in `pipeline.ts`); OCR bboxes are already device px. |
| First run stalls ~1 min | Model weights downloading. Wait; it is cached afterwards. |
| `POST /agent/step` 400 | Manifest failed `RedactionManifestSchema` — check the offscreen console for the zod error. |
