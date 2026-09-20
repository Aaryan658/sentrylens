# SentryLens — Frontier-Level Research Report
*Generated 2026-09-15 · 3 parallel research passes · ~30 sources*

Goal: find what would move SentryLens from "solid working hackathon prototype" to something SIH judges treat as a genuine research/engineering contribution, and give concrete, days-buildable steps to get there.

---

## 1. The gap is real, current, and vendor-admitted (use this in the pitch verbatim)

Every major AI-agent vendor ships raw-screenshot-to-cloud with no on-device redaction layer:

- **Anthropic** (Claude computer use): its own [reference implementation README](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-best-practices/README.md) states there are **"no safeguards against it taking screenshots that contain sensitive information and uploading them to the API."** The [Privacy Center](https://privacy.claude.com/en/articles/10030352-what-personal-data-will-be-processed-by-computer-use) confirms screenshots are processed as-is; mitigation is "close sensitive apps before using computer use," i.e. offloaded to the user.
- **OpenAI** (ChatGPT agent/Operator): screenshots sent to and stored in the cloud, [per OpenAI's own help center](https://help.openai.com/en/articles/11752874-agent); "takeover mode" only pauses screenshotting while the user types manually — a UX pause, not a redaction system.
- **Google** (Project Mariner → Gemini computer use): [shut down Mariner in May 2026](https://www.theverge.com/tech/925559/google-project-mariner-shut-down) having never published PII/credential-handling documentation — independent security analysis calls this "the critical gap... the absence of answers is why security-conscious organizations can't evaluate this for production."
- **Microsoft** (OmniParser V2 / Copilot Vision): Microsoft's own [write-up](https://www.microsoft.com/en-us/research/articles/omniparser-v2-turning-any-llm-into-a-computer-use-agent/) limits "responsible AI" mitigation to not inferring race/religion from faces — no PII filtering; punts responsibility to the user.
- **Perplexity Comet**: independently shown to leak every visited URL even with privacy toggles off ([Shivan Kaul Sahib](https://shivankaul.com/blog/comet-privacy)); [Trail of Bits](https://blog.trailofbits.com/2026/02/20/using-threat-modeling-and-prompt-injection-to-audit-comet/) and [Brave](https://brave.com/blog/comet-prompt-injection/) both demonstrated prompt-injection exfiltration of Gmail contents; LayerX found a one-click "CometJacking" exploit.
- **The Browser Company (Dia)**: [privacy policy](https://www.diabrowser.com/privacy) confirms page context is sent through servers to third-party AI partners on every AI request, no client-side redaction.

Quantified risk to cite: **[PriMobiBench](https://arxiv.org/abs/2609.13873)** (Sept 2026) — VLM agents extract sensitive on-screen info at 82.5% success, infer user profiles at ~70% from raw screenshots. **[VisualLeakBench](https://arxiv.org/html/2606.07595v1)** — prompt-only mitigation (what every vendor above relies on) still leaks PII into tool-calls 2–52% of the time — hard evidence that on-device redaction is architecturally necessary, not a nice-to-have.

## 2. Newer work to know / differentiate from (2025–2026)

- **[Minim](https://arxiv.org/html/2606.13949v1)** — local broker scoring UI elements by sensitivity *and* task-necessity via Contextual Integrity theory, rather than static PII categories. Worth citing as theoretical grounding.
- **[WebPII/WebRedact](https://www.arxiv.org/pdf/2603.17357)** — first visual-PII benchmark for web screenshots (44,865 images); their model hits 0.753 mAP@50 at 20ms/CPU — a real comparator for your pipeline.
- Open-source local-redaction extensions now exist (Veil, Privacy Guardrail, MAYA AI-Safe-Plugin, Obscura, PII Shield, image-pii-redactor, w3pn-anonymizer) — **but none execute an agentic click/type loop with placeholder resolution back to real values**. That end-to-end redact→act→resolve loop is where your actual novelty sits versus the OSS landscape — say this explicitly in the pitch rather than assuming judges will infer it.

## 3. What separates "impressive demo" from "credible research" (judge/reviewer signals)

Recurring theme across judge retrospectives ([1](https://dev.to/kurbaitaev/what-judges-actually-score-notes-from-a-year-of-hackathon-judging-3p4l), [2](https://dev.to/pranjulrathour/what-hackathon-judges-actually-look-for-a-rubric-from-both-sides-of-the-table-39o), [3](https://dev.to/amising6/what-i-learned-after-reviewing-many-ai-and-developer-projects-as-a-hackathon-judge-2g06)): **honesty about limitations + evidence over claims**. One rubric weights "scope judgement and honesty" at 20%, on par with the demo itself. For security tools specifically, the bar is: an explicit threat model, comparison against *named external baselines*, and demonstrated adversarial robustness — not just clean-path correctness.

## 4. Named benchmarks to adopt instead of your own 5-fixture eval

Your current "0% leakage / 0% over-masking / 100% task-necessity" is on 5 self-authored fixtures — a judge can reasonably ask "is that your number or ours?" These are real, citable benchmarks to run a subset against instead:

- **[REDACT](https://arxiv.org/html/2606.19881)** — 13,427 records, 51 entity types, GDPR sensitivity tiers. Its key finding is directly reusable in your pitch: aggregate F1 *hides* failures — Presidio scores 0.07 recall on HIGH-sensitivity entities despite decent overall F1. Report your recall **split by sensitivity tier**, not just an aggregate.
- **[PII-Bench](https://aclanthology.org/2026.acl-long.227/)** (ACL 2026) — 2,842 samples testing *query-relevance* of masking, not just detection.
- **[RedacBench](https://arxiv.org/pdf/2603.20208)** — measures security (sensitive info removed) *and* utility (non-sensitive info preserved) as a pair — maps directly onto your existing leakage/over-masking framing, just externally validated.

## 5. Proving "no-leak" beyond unit tests

- **Static taint analysis as a CI gate**: DoubleX ([CCS'21](https://swag.cispa.saarland/papers/fass2021doublex.pdf), [code](https://github.com/Aurore54F/DoubleX)) builds a dependence graph proving no path exists from attacker-controlled input to a sensitive sink. A scoped-down version (or a CodeQL query) proving **no code path from raw screenshot/DOM capture to any network sink outside the redaction module** turns "our tests pass" into "we can show no such path exists" — structural, not statistical.
- **Software "redaction receipt"**: sign a JSON manifest (hash of pre-redaction image, hash of post-redaction image, redaction log, timestamp) with an on-device-generated keypair. This mirrors [C2PA's redaction-assertion model](https://spec.c2pa.org/specifications/specifications/2.4/specs/ContentCredentials.html), which explicitly supports "redacted_assertions" as a first-class concept. **Say explicitly this is software-only attestation, not hardware TEE** — full TEE/remote attestation (Arm CCA, Intel TDX) is real precedent ([AVEC](https://arxiv.org/html/2509.10561v1), [AgenTEE](https://arxiv.org/abs/2604.18231)) but not a days-task; mention it as roadmap, don't attempt it.

## 6. Your exact threat model is an active, disclosed attack class right now

- **BioShocking** (LayerX, mid-2026): got six agentic browsers, *including Anthropic's own Claude-for-Chrome extension*, to exfiltrate SSH credentials via fictional-framing prompt injection ([CSA research note](https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/07/CSA_research_note_bioshocking_ai_browser_credential_leak_20260708-csa-styled.pdf)).
- **WebPromptTrap / CometJacking** — invisible-CSS instruction hiding in the wild ([Cato Networks](https://www.catonetworks.com/blog/webprompttrap-new-indirect-prompt-injection-vulnerability/)).
- Ready-to-run red-team tooling against your exact setup: **[IPI-proxy](https://www.alphaxiv.org/abs/2605.11868)** (MIT-licensed MITM proxy injecting 820 deduplicated payloads from six published benchmarks — BIPIA, InjecAgent, AgentDojo, WASP), **[WASP](https://arxiv.org/html/2504.18575v3)** (ICML 2025), **[BrowseSafe-Bench](https://arxiv.org/html/2511.20597)** (14,719 samples, 11 attack types).

## 7. India / DPDP / ISRO narrative (grounded, not generic filler)

- **DPDP Rules were notified 13 Nov 2025**; core obligations including **"encryption or masking"** as a named required safeguard become enforceable **13 May 2027**, penalties up to ₹250 crore ([MeitY notification](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?pageTitle=Digital-Personal-Data-Protection-Rules-2025.pdf); [tracker](https://dpdprules.org/blog/dpdp-act-rules-what-is-in-force-2026)). **The law names masking specifically, and the enforcement clock is now running** — strong, current hook.
- MeitY's Nov 2025 **India AI Governance Guidelines** explicitly flag that autonomous AI agents "may require us to rethink current approaches to governance" and call for audit trails ([PDF](https://indiaai.s3.ap-south-1.amazonaws.com/docs/guidelines-governance.pdf)). The AI Safety Institute is funding 13 adjacent Responsible-AI projects (federated learning, unlearning, deepfake detection) — **none targeting on-device redaction for browser agents specifically**: real whitespace ([PIB](https://www.pib.gov.in/PressReleasePage.aspx?lang=1&PRID=2289946&reg=3)).
- **AI agents are already being wired into ISRO's own portals with zero redaction**: a `bhoonidhi-mcp` package lets agents log into and query Bhoonidhi ([PyPI](https://pypi.org/project/bhoonidhi-mcp/)); teams built MOSDAC help-bots for ISRO's own Bharatiya Antariksh Hackathon 2025 (e.g. [SatSage](https://github.com/rupeshbharambe24/SatSage)). **This is your exact threat scenario, already live, on an ISRO-adjacent portal** — a much sharper "why now" than anything hypothetical.
- Adjacent Indian prior art to differentiate from, not just cite: [Manyu Logics' Pinaakini](https://manyulogics.com/products.html) (Aadhaar/PAN/UPI/GSTIN text redaction, network-layer, not on-device/visual) and [pii-shield](https://github.com/vikasgautam18/pii-shield) (server-side Presidio, no face/visual redaction, no agent loop). Neither does on-device visual perception driving a live agent — your combination is the differentiator.

## 8. Buildable differentiators, effort-ranked

| # | Idea | Effort | Precedent |
|---|------|--------|-----------|
| 1 | Adversarial/red-team fixture suite (prompt injection, hidden CSS, OCR-evasion) run against your own agent, report attack-success rate | Low–Med | WASP, BrowseSafe-Bench, IPI-proxy, Muzzle — extends the OCR-homoglyph fix you already shipped |
| 2 | Benchmark subset against REDACT/PII-Bench/RedacBench instead of only self-authored fixtures | Low | Directly rebuts "is that your number" |
| 3 | Structural no-leak proof (CodeQL/DoubleX-style CI gate: no path from raw capture to network sink outside redaction module) | Low–Med | DoubleX (CCS'21) |
| 4 | Software "redaction receipt" — signed pre/post-redaction hash manifest | Med | C2PA redacted_assertions |
| 5 | Indian-ID-format hardening (checksum-aware Aadhaar/PAN/GSTIN, adversarial-OCR defenses) | Low | Manyu Logics, pii-shield |
| 6 | Publish eval harness + fixtures + benchmark results as a small reproducible public repo | Low | FuzzingBrain/AIxCC leaderboard credibility move |
| 7 | One-page explicit threat model doc (attacker capabilities, trust boundary, explicit out-of-scope) | Low | Citing BioShocking/WebPromptTrap as in-scope attack class |
| 8 | Minimal two-tab multi-agent demo | High / risky | Only attempt if 1–7 land early |

**Not recommended for a days budget** (mention only as future work): hardware TEE/remote attestation (needs specific silicon), full format-preserving encryption.

---

## Sources
See inline links throughout. Full agent transcripts covered ~30 sources across arXiv, vendor documentation, security-firm disclosures, MeitY/PIB government publications, and GitHub.
