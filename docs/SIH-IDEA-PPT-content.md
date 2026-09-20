# SentryLens — SIH 2026 IDEA PPT content

**Rules honoured:** 6 slides max (incl. title) · points not paragraphs · every slide has a diagram/infographic hook · unique + novel framing up front.

**Visual direction (for whoever builds the deck):** dark title + closing slide, light content slides. One motif: a **trust boundary** — a vertical divider with a padlock; everything left of it is "on your device", everything right is "the cloud model". Repeat it on slides 2, 3, 5. Palette: deep space navy `#0B1F3A`, ice blue `#9EC5FF`, one sharp signal-amber `#FFB020` for the redaction masks. Header font Georgia/Cambria, body Calibri.

---

## SLIDE 1 — TITLE PAGE (fill-ins only)

- **Problem Statement ID:** SIH26171
- **Problem Statement Title:** On-Device Visual Perception for Light-weight Browser Agents
- **Theme:** Space Technology (ISRO)  · *confirm exact theme label on the portal*
- **PS Category:** Software
- **Team ID:** _<your team ID>_
- **Team Name:** _<your registered team name>_
- **Project name on the slide:** **SentryLens** — *"The agent sees the task, never your secrets."*

---

## SLIDE 2 — IDEA / PROPOSED SOLUTION

**One-liner (top of slide):** A browser extension that lets an AI agent finish your web task while faces, passwords and PII never leave your machine.

**The idea — 3 points:**
- **On-device eyes:** a WebGPU vision pipeline "reads" the live screen — pixels *and* DOM — entirely inside the browser.
- **Redact before it leaves:** faces, passwords, Aadhaar / PAN / card / phone / names are masked locally; only an *anonymised screenshot + a typed redaction manifest* cross the network.
- **Reversible on the client only:** the remote VLM reasons over placeholders like `PHONE#a1b2`, returns one action per step; the extension swaps the real value back in and executes. The value↔placeholder table never leaves the device.

**How it addresses the problem:**
- Closes the blind spot of DOM/regex filters — PII burned into images, canvas, iframes and screen-share is caught at the **pixel** level.
- Server is redaction-aware *by contract*, not by a blurred JPEG: manifest carries `category`, `bbox`, `value_len`, `risk`, `task_necessary` → the agent still grounds and acts.

**Innovation & uniqueness:**
- **First polished Chrome/Edge MV3 + WebGPU build** of the "trustworthy local–remote hybrid" that 2025–26 research (GUIGuard, "Available but Invisible") only prototyped for mobile.
- **Provable non-leak:** built-in service-worker network firewall + airplane-mode demo → zero outbound pixel bytes, perception still runs.
- **Deterministic, type-preserving placeholders** with cross-step memory (same entity → same token across screens); high-contrast masks with in-box `[CATEGORY#hash]` so the model reasons about *what is hidden*.

**Diagram:** split screen — "What you see" (real dashboard) vs "What the server sees" (black masks + manifest JSON).

---

## SLIDE 3 — TECHNICAL APPROACH

**Architecture — 3 layers (draw as a stack, trust boundary between L2 and L3):**
- **L1 Perception** — offscreen document, WebGPU: DOM walk → element list · `yolos-tiny` region detector · Tesseract.js OCR (per-word boxes) · GLiNER on-device PII NER · MediaPipe face detector · SmolVLM-256M one-line screen summary.
- **L2 Redaction engine** (trusted): fuse DOM + vision + OCR + NER + faces → risk classifier → validators (regex + **Luhn** cards / **Verhoeff** Aadhaar / PAN / IFSC) → canvas black-box masking → session value↔placeholder table → emits **sanitised PNG + JSON manifest**.
- **L3 Server** (untrusted): Node/Express thin proxy → open-weight **Qwen2.5-VL-32B** (OpenAI-compatible; Ollama/vLLM for offline) → returns one `AgentAction` per step.

**Stack:**
- Extension: **WXT (MV3) + TypeScript + React** side panel.
- In-browser ML: `@huggingface/transformers` v4 + `onnxruntime-web` — **WebGPU → WASM fallback**.
- Contracts: **zod** schemas in a shared package, runtime-validated at every boundary.
- Server: provider-agnostic OpenAI client + JSON-repair retry; `MOCK` mode for a deterministic demo.

**Execution loop (flow-chart):**
perceive viewport → fuse signals → classify + mask → `POST {masked PNG, manifest, history}` → VLM action → **resolve placeholder locally** → execute click / type / scroll → repeat until *done*.

**Engineering rigor (proof, not promises):**
- **63 unit tests** — contracts, checksums, mapping determinism + OCR-noise tolerance, no-leak manifest, mask planning, agent loop, firewall rules.
- **Headless end-to-end:** real OCR + real NER + real pixel masking → asserts **no raw PII** in the manifest, the request body, *or the sanitised image pixels*.

---

## SLIDE 4 — FEASIBILITY AND VIABILITY

**Feasibility — it already runs:**
- Every layer is a mature open-source component; end-to-end demo works today on a local ISRO-style ops console (login → dashboard → open report → done).
- Runs on stock **Chrome/Edge 113+**; ~1–2 s perception per step, 2–3 s on integrated-GPU laptops — interactive.
- No GPU server for the client; server model cloud-hosted during SIH, self-hostable (Ollama / vLLM) for deployment.

**Challenges & risks → mitigation:**
- WebGPU absent on venue laptop → feature-detect + **automatic WASM fallback**; VLM step skipped with a visible notice, no crash.
- OCR noise / missed PII → fuzzy-match to mapping table + conservative checksum layer + **manual review overlay** (toggle / add / remove boxes).
- Over-masking breaks the task → per-region `risk` + `task_necessary` flag; tracked as an explicit metric.
- MV3 service-worker evicts models → models isolated in a **persistent offscreen document**.
- Connectivity loss → **3-tier degradation:** WebGPU→WASM · server-down→on-device answer · model-not-cached→DOM-only conservative redaction.

**Viability:**
- Config-swap between local vLLM and any hosted OpenAI-compatible endpoint → **no vendor lock-in**.
- Session-scoped, bounded local state; **stateless server** → scales horizontally.

---

## SLIDE 5 — IMPACT AND BENEFITS

**Who benefits:**
- ISRO / government / enterprise operators working over sensitive dashboards (Bhoonidhi, MOSDAC, internal consoles) who want AI copilots **without screen contents reaching a third-party model**.
- Any regulated sector — healthcare, banking, defence — with the same "AI help, but not with our data" constraint.

**Benefits:**
- **Security / sovereignty:** PII leakage rate target → **0**; faces & passwords never leave the machine; canvas re-export strips EXIF.
- **Utility retained:** redaction-aware manifest keeps task-success within ~90 % of the un-redacted baseline (literature: 80.8 % vs 83.6 %, leakage ↓ 31.6 pp).
- **Economic:** no need to build or host a private frontier VLM — use cheap open-weight models safely; drop-in for existing browser workflows.
- **Social:** makes AI agents adoptable inside institutions that currently **ban** them on privacy grounds.
- **Offline:** works after first model cache → usable in air-gapped / low-connectivity field stations.

**Success metrics post-deployment:** PII leakage rate · task-success retention vs baseline · over-masking rate · user overrides / session · % tasks completed offline.

**Infographic:** 5 icons in amber circles — padlock, gauge (~90 %), rupee, people, wifi-off.

---

## SLIDE 6 — RESEARCH AND REFERENCES

**Research foundation:**
- **GUIGuard** — privacy recognition → protection → remote exec; GUIGuard-Bench (13,830 screenshots, region-level labels). arXiv 2601.18842
- **"Anonymization-Enhanced… Available but Invisible"** — PII detector + UI transformer + Secure Interaction Proxy + local gatekeeper; placeholder grammar `CATEGORY#hash`. arXiv 2602.10139
- **DualTAP + PrivScreen** — privacy–utility metrics (leakage ↓ 31.6 pp; task success 80.8 % vs 83.6 %). arXiv 2511.13248
- **MaskClaw** — per-user Allow / Mask / Ask policy memory. arXiv 2605.28646
- **Qwen2.5-VL Technical Report** — box & point UI grounding, JSON coordinates. arXiv 2502.13923
- **OmniParser V2 (Microsoft Research)** — screenshot → structured elements + numeric IDs for VLM action.
- **SmolVLM** (arXiv 2504.05299) · Transformers.js WebGPU guide · `chrome.offscreen` API docs · MediaPipe Face Detector (web).
- **Validators:** Luhn (cards), Verhoeff (Aadhaar), PAN / IFSC regex — as used by ScreenMask.

**Our prototype:** github.com/Aaryan658/sentrylens — installable Chrome/Edge WebGPU extension + thin server, 63 unit tests + headless no-leak E2E.

**Our contribution:** first installable browser implementation of this paradigm, with a **typed reversible redaction manifest** and a **network-firewall non-leak proof**.
