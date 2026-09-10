# SentryLens

On-device visual perception for privacy-preserving browser agents — SIH26171 (ISRO).

A Chrome/Edge MV3 extension + a thin server. Screen perception and PII redaction run
entirely on-device (WebGPU, with a WASM fallback); only an **anonymised screenshot +
a typed redaction manifest** reach the remote open-weight VLM. The VLM reasons over
the manifest and returns one action per step; the client resolves anonymised
placeholders **locally** and executes them. A session value↔placeholder table never
leaves the browser.

## How it works (one step)

```
content script                 offscreen document (WebGPU)            server
──────────────                 ──────────────────────────            ──────
DOM walk ─ elements+bboxes ──▶ tesseract OCR ─▶ transformers NER
captureVisibleTab ─ PNG ─────▶ mediapipe faces ─▶ YOLOS detector
                               fuse(dom, vision, ocr, ner)
                               classify risk ─▶ build manifest
                               paint masks over PII pixels ──────────▶ POST /agent/step
                                                                       {masked png, manifest, history}
                               resolve placeholders ◀── one AgentAction ─┘
executor: click / type / scroll on the real page
```

The manifest carries `category`, `bbox`, `value_len`, `risk` and a `CATEGORY#hash`
placeholder — never the value. `type` actions may contain a placeholder; the
offscreen document swaps in the real value from the session table just before the
content script types it.

## Deliverable mapping (PS SIH26171)

| PS ask | Where |
|---|---|
| Local vision processing (WebGPU) | `extension/src/perception/*` — OCR, NER, faces, YOLOS detector, SmolVLM summary |
| Privacy-preserving filter | `extension/src/redaction/*` — `validators`, `fuse`, `classify`, `manifest`, `mask`, `mapping` |
| Server-side integration | `server/` — `/agent/step`, OpenAI-compatible provider, JSON-repair retry |
| Redaction-aware server | `server/src/prompt.ts` + the `RedactionManifest` contract in `shared/` |
| Working prototype (popular browsers) | Chrome/Edge MV3 build in `extension/.output/chrome-mv3`, target `demo/demo-dashboard.html` |
| Outbound firewall | `extension/src/firewall.ts` — `declarativeNetRequest` allowlist |

## Quickstart

```bash
pnpm install
cd server && cp .env.example .env && pnpm start      # MOCK=1 by default, :8787
pnpm --filter @sentrylens/extension build            # -> extension/.output/chrome-mv3
npx serve demo                                        # open the printed URL
# chrome://extensions -> Developer mode -> Load unpacked -> extension/.output/chrome-mv3
```

Full walkthrough and the Chrome verification checklist: **[docs/DEMO.md](docs/DEMO.md)**.
Research and design rationale: `SIH26171_Deep_Research_Report.md`,
`docs/superpowers/specs/2026-09-09-sentrylens-design.md`.

## Verification

| Command | What it proves |
|---|---|
| `pnpm test` | 60 unit tests — contracts, Luhn/Verhoeff, mapping determinism + OCR-noise tolerance, signal fusion, manifest no-leak, mask planning, server parse/mock/endpoint, DOM walk, executor, agent loop, firewall rules |
| `pnpm typecheck` | strict TS across `shared` / `server` / `extension` |
| `pnpm --filter @sentrylens/extension e2e` | **headless end-to-end**: real tesseract OCR + real transformers NER → `assemblePerception` → real pixel masking (sharp) → mock server round-trip; asserts no raw PII in the manifest, the request body, **or the sanitised image pixels**. Needs the server up on `:8787`. Set `E2E_VLM=1` (server in `MOCK=0`) to exercise a real VLM. |

Still requires Chrome (see `docs/DEMO.md`): the MV3 shell (service worker, offscreen
document, side panel, `declarativeNetRequest`), the WebGPU path, `mediapipe` face
detection, SmolVLM summary, and the canvas masking in `mask.ts` (its planning step
`planMasks` is unit-tested; the pixel outcome is proven headless via `sharp`).
