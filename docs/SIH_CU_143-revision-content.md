# SIH_CU_143.pptx — Revision Content Package
*Everything needed to update the deck by hand. Copy-paste ready. No design work done here — see the "Design notes" section at the bottom for the visual fixes to make alongside this.*

---

## 0. Fix these bugs first (highest priority, near-zero effort)

1. **Title slide logo says "SMART INDIA HACKATHON 2022."** The bundled logo asset is the wrong year. Replace with the current official SIH 2026 logo/branding asset from the portal.
2. **Every diagram is Napkin.ai output, several still showing the "Made with Napkin" watermark.** At minimum crop/regenerate to remove the watermark. Ideally replace with diagrams that share one visual language (see Design notes).
3. **Slide 5's impact numbers are literature citations, not your own.** Currently: "~90% task-success retention, 80.8% vs 83.6% literature comparison, 31.6 percentage points leakage reduction." These are from cited papers, not measured on SentryLens. Replace with the real numbers in section 4 below.

---

## 1. NEW content block: "Even the Frontier Labs Don't Solve This"

This is the single highest-leverage addition. Add as a new slide, or as a replacement for the weakest existing Napkin diagram on Slide 2 or Slide 5. It pre-empts the "why hasn't Google/Anthropic already done this" question judges will otherwise think but not ask.

**Suggested slide title:** *Even the Frontier Labs Don't Solve This*
**Suggested subhead:** *Every major AI-agent vendor ships raw screenshots to the cloud. None of them redact.*

Five short rows (vendor — what they do — source), written to be pasted as a table or icon-row layout:

| Vendor / Product | What they actually do | Source |
|---|---|---|
| **Anthropic** (Claude computer use) | Their own reference implementation states there are **"no safeguards against it taking screenshots that contain sensitive information and uploading them to the API."** | [github.com/anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-best-practices/README.md) |
| **Google** (Project Mariner → Gemini computer use) | Shut down Project Mariner in May 2026 having **never published documentation** on how it handles credentials or PII during a session. | [theverge.com](https://www.theverge.com/tech/925559/google-project-mariner-shut-down) |
| **OpenAI** (ChatGPT agent / Operator) | Screenshots are sent to and **stored in the cloud**; the only privacy control is "takeover mode," which just pauses screenshotting while the user types manually. | [OpenAI Help Center](https://help.openai.com/en/articles/11752874-agent) |
| **Perplexity Comet** | Independently shown to **leak every visited URL even with all privacy toggles switched off**; three separate security firms (Trail of Bits, Brave, LayerX) disclosed prompt-injection attacks exfiltrating Gmail contents in 2025–2026. | [Shivan Kaul Sahib](https://shivankaul.com/blog/comet-privacy) · [Trail of Bits](https://blog.trailofbits.com/2026/02/20/using-threat-modeling-and-prompt-injection-to-audit-comet/) |
| **The Browser Company** (Dia) | Own privacy policy confirms prompts and page context are sent through their servers to third-party AI partners on **every** AI request — no client-side redaction. | [diabrowser.com/privacy](https://www.diabrowser.com/privacy) |

**Closing line for the slide (verbatim, use as-is or adapt):**
> "This isn't a problem the frontier labs politely declined to solve — it's a gap they've functionally admitted to, in their own documentation, while shipping anyway. We closed it in a browser extension, on-device, without needing a frontier lab's resources."

**Optional supporting stat** (use if there's room): [PriMobiBench](https://arxiv.org/abs/2609.13873) (Sept 2026) found VLM agents extract sensitive on-screen info with **82.5% success** and infer user profiles with **~70% success** from raw screenshots — this is the risk these vendors are leaving unaddressed.

---

## 2. Slide 2 (Idea) — positioning table

Replace or supplement the current "Traditional AI Browser Agent" comparison with a three-way table. This preempts "doesn't this already exist" by showing you've mapped local-redaction tools too, not just the big cloud agents:

| | Cloud AI browser agents (Claude, Operator, Gemini, Comet) | Local PII-redaction extensions (Veil, PII Shield, MAYA, etc.) | **SentryLens** |
|---|:---:|:---:|:---:|
| Redacts before sending | ❌ | ✅ (text only, no visual) | ✅ (pixels + DOM) |
| Drives an actual agentic action loop | ✅ | ❌ (copy-paste helper only) | ✅ |
| Placeholder resolved back to real value locally | — | — | ✅ |

**Framing line:** *"Open-source local-redaction tools exist — but none of them drive a live agent action loop with values resolved back on-device. That end-to-end redact → act → resolve cycle is what SentryLens adds that neither camp has."*

---

## 3. Slide 3 (Technical Approach) — pull these forward from Slide 6

Right now this slide is a single diagram with no supporting text. Add:

**Stack line:**
> WXT (MV3) + TypeScript + React side panel · Transformers.js v4 + onnxruntime-web (WebGPU → WASM fallback) · zod-validated contracts at every trust boundary

**Rigor proof line (your best credibility signal — don't leave it buried on the references slide):**
> **63 unit tests + a headless end-to-end test asserting zero raw PII in the manifest, the request body, or the sanitized image pixels.**

**One-line threat model (signals rigor per what SIH judges explicitly look for in security tooling):**
> *Threat model: an adversarial or compromised remote VLM, or a network-level observer between device and server. Out of scope: a compromised OS or physical device access.*

---

## 4. Slide 5 (Impact) — replace the numbers, add the hooks

### 4a. Real measured numbers (use these instead of the literature citation)

Source: [docs/EVAL_RESULTS.md](EVAL_RESULTS.md), generated 2026-09-14 from the actual on-device pipeline (tesseract.js OCR + `multilang-pii-ner` NER) against 5 synthetic fixtures — **every number below is SentryLens's own, not a citation:**

| Metric | Value |
|---|---|
| PII leakage rate | **0.0%** (0/9 ground-truth PII items leaked) |
| Over-masking rate | **0.0%** (0/9 — no benign content wrongly redacted) |
| Task-necessity accuracy | **100.0%** (1/1) |

**Honest scope caveat to include (this is a *strength*, not a weakness — judges explicitly reward honesty about limitations):**
> *"Measured on a small (5-fixture), synthetic, English-text benchmark we built — not yet validated against a large external benchmark. We're already fixing this: next step is running against REDACT (13,427 records, 51 entity types) and RedacBench for an independently comparable number."*

**Suggested framing headline:** *"0% leakage — not cited from a paper, measured on our own system, honestly scoped."*

### 4b. India / "why now" hook — add this, it's sharper than anything generic

> AI agents are **already being pointed at ISRO's own portals with zero redaction layer**: a community-built `bhoonidhi-mcp` package lets AI agents log into and query Bhoonidhi today ([PyPI](https://pypi.org/project/bhoonidhi-mcp/)), and teams built MOSDAC chatbots for ISRO's own Bharatiya Antariksh Hackathon 2025 (e.g. [SatSage](https://github.com/rupeshbharambe24/SatSage)). This isn't a hypothetical risk — it's happening now, unprotected.

### 4c. DPDP Act compliance hook

> The **Digital Personal Data Protection Rules, 2025** were notified 13 November 2025 and name **"encryption or masking"** as an explicitly required safeguard; core obligations become enforceable **13 May 2027**, with penalties up to ₹250 crore. ([MeitY notification](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025.pdf)) SentryLens is pre-compliant for a law with a deadline that's already ticking.

### 4d. Fix the traffic-light diagram
The current "Understanding data privacy" diagram uses a traffic-light metaphor (implies stop/go) to list five unrelated metrics (PII leakage rate, task-success retention, over-masking rate, user overrides, % offline). The metaphor doesn't match the content. Replace with a plain stat row or gauge cluster — five numbers, five labels, no forced metaphor.

---

## 5. Slide 4 (Feasibility) — name the actual components

Current copy ("Utilize reliable open-source parts") is too vague to read as engineered. Replace with the named stack:

> **Perception layer:** yolos-tiny (region detection) · Tesseract.js (OCR) · GLiNER (on-device PII NER) · MediaPipe (face detection) · SmolVLM-256M (screen summary)

**Optional adversarial-hardening line** (only if a small red-team pass gets done before presenting — high-impact if so):
> *"Hardened against known prompt-injection attack classes — including the hidden-CSS instruction-injection technique that got Claude-for-Chrome (Anthropic's own extension) to exfiltrate SSH credentials in a mid-2026 disclosure."* Source: [BioShocking, Cloud Security Alliance](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/07/CSA_research_note_bioshocking_ai_browser_credential_leak_20260708-csa-styled.pdf)

---

## 6. Slide 6 (References) — additions

Add these 2026 papers to show you're citing the bleeding edge, not a fixed reading list from when the plan was first written:

- **PriMobiBench** (Sept 2026) — [arXiv 2609.13873](https://arxiv.org/abs/2609.13873) — quantifies exactly the risk you're solving (82.5% extraction success, ~70% profiling success from raw screenshots)
- **VisualLeakBench** (2026) — [arXiv 2606.07595](https://arxiv.org/html/2606.07595v1) — shows prompt-only mitigation (what every vendor above relies on) still leaks PII into tool-calls 2–52% of the time
- **REDACT** (2026) — [arXiv 2606.19881](https://arxiv.org/html/2606.19881) — named benchmark (13,427 records, 51 entity types) to cite as your next external validation target
- **Minim** (2026) — [arXiv 2606.13949](https://arxiv.org/html/2606.13949v1) — Contextual Integrity-based local broker; cite as related theoretical grounding

---

## 7. If your friend only has time for 3 changes

In order of impact-to-effort:
1. **Fix the 2022 logo** (2 minutes, prevents an embarrassing first impression)
2. **Swap Slide 5's numbers** for the real ones in section 4a (numbers already computed, just copy-paste)
3. **Add the "Even the Frontier Labs Don't Solve This" content** from section 1 (this is the single most persuasive addition — every fact is sourced and ready to paste)

---

## Design notes (not content, but relevant if there's time)

- Every current diagram is Napkin.ai-generated, in at least 6 different unrelated visual styles (diamond stack, chain links, keys, traffic light, numbered pills, box+arrow). Committing to **one** repeated visual motif (icon-in-colored-circle, or the navy/ice-blue "trust boundary" padlock motif originally planned in [docs/SIH-IDEA-PPT-content.md](SIH-IDEA-PPT-content.md)) across all slides will read as far more deliberate than six auto-generated diagrams.
- Remove all "Made with Napkin" watermarks before presenting — even one visible watermark undercuts a "frontier engineering" narrative instantly.
