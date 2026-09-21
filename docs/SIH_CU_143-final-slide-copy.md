# SIH_CU_143 deck: final slide copy and diagram placement

This replaces `SIH_CU_143-revision-content.md` (older plan, now stale). Do not edit the PPT from here; a teammate edits it by hand. Diagram files are in `docs/diagrams/`, demo images in `docs/demo/`.

## Slide 1
No change.

## Slide 2: idea
- Title (replaces "IDEA TITLE"): SentryLens: the agent sees your task, never your secrets
- Hero visual: a REAL before/after screenshot from the running extension (before = the dashboard page, after = the masked image from the /agent/step request). Fallback: `before-after-split.svg`. Delete the five SmartArt diagrams and the three banner boxes.
- Flow strip visual: `flow-strip.svg`.
- Opening: AI browser agents work by sending screenshots of your screen to a cloud model. Everything on screen goes with them, including faces, passwords, Aadhaar and PAN numbers.
- What we do: SentryLens runs in your browser and blacks out sensitive content on your own device first. The cloud model only gets the cleaned screenshot and a list of what was hidden. When it says "type PHONE#a1b2", your browser swaps in the real number locally. The real value never leaves your machine.
- Table: cloud browser agents hide nothing before sending; local redaction tools hide text only and cannot act on a page; SentryLens hides pixels and page elements, acts on the page, and restores real values on your device. Footnote: based on the tools we reviewed; none of the local ones ran an agent loop.
- Evidence line: Anthropic's own computer-use example says it has "no safeguards" for sensitive screenshots. OpenAI stores agent screenshots in the cloud. Trail of Bits, Brave and LayerX each showed Perplexity's Comet leaking data through prompt injection. Google shut down Project Mariner in May 2026, and we found no public write-up of how it handled personal data.

## Slide 3: technical approach
- Visual: `architecture.svg` (device left, cloud right, padlock line between).
- Fixes: "Task Task Necessary" becomes "Task necessary"; delete the stray "Layer1 /2" box; move the purple band down so the SIH logo is not clipped.
- Add: "160+ automated tests, plus a headless end to end check that no raw PII reaches the request." (163 at 2026-09-20; say "160+" so it does not go stale.)
- Add: "We treat the cloud model and the network as untrusted. We do not defend against a compromised laptop."
- The backstop stays enabled (tightened 2026-09-20: it ignores thin lines and hollow outlines such as input borders), so the line may be added: "if OCR reads nothing in a spot that still looks like text, we black it out anyway." Say plainly it can also black out a few benign words OCR missed (a label, a button caption).

## Slide 4: feasibility
- Visuals: `fallback-ladder.svg` plus one real demo screenshot. Cut the Venn, warning triangle, pie cycle and chevron strip.
- Why it works today: open-source parts (Chrome or Edge, WebGPU with WASM fallback, Tesseract.js, GLiNER, MediaPipe), no GPU server, about 1 to 2 seconds a step (2 to 3 on an integrated GPU), demo runs end to end.
- Problem and fix table: WebGPU missing -> WASM; OCR misses text -> fuzzy matching and checksums (Luhn, Verhoeff); over-masking -> risk score plus task_necessary flag; Chrome kills the worker -> persistent offscreen page; connection drops -> the task stops and nothing leaves the device (fails closed).
- Why it is viable: any OpenAI-compatible model (no lock-in), stateless server scales sideways, on-device perception (OCR, NER, faces) keeps running once its models are cached (the agent step itself needs the server).
- VERIFIED 2026-09-20 (against `extension/src/agent/loop.ts`): the old rung 3 "server unreachable, on-device model keeps working" does NOT exist. There is no on-device agent model; a failed server call ends the task. `fallback-ladder.svg` rung 3 now says "The task stops. Nothing leaves the device." Do not claim an offline agent.
- RESOLVED 2026-09-20: before this date the caption "Privacy never drops. Only features do." was false, because a run with failed or uncached on-device models sent the image with page-marked (DOM) redaction only. `runAgent` now stops such a run before anything is sent ("on-device perception is degraded ... nothing was sent"), so rung 4 should read "Models not cached yet -> the task waits; nothing is sent" and the caption is true. Demo note: the first run can hit this while models download; retry once they have loaded. `fallback-ladder.svg` rung 4 now says "The task waits. Nothing is sent." (re-embed the SVG in the deck).

## Slide 5: impact
- Visuals: `big-numbers.svg` (0 of 15 leaked, 0 of 6 attacks) and `attack-tiles.svg`. Drop the three-series bar chart (or keep one small chart only if the grey literature bars get a citation). If a chart stays: title it "Measured on our own tests: 6 screens, 15 sensitive items" (not "9 Fixtures") and fix the legend overprinting the axis.
- Security: 0 of 15 sensitive items leaked in our tests (6 test screens, one of them a realistic dark-theme login and roster page); on that page nothing benign was masked as a false value, but the fail-closed backstop blacks out text OCR cannot read, such as the caption on a white-on-blue button. Say so if asked about over-masking. Also true and worth one line: we ran the real demo page in real Chrome at four display scales (100%, 125%, 150%, 200%) and counted glyph pixels still visible under the masks: none.
- Security (continued): six evasion tricks (faint text, tiny text, spaced digits, lookalike letters, no labels, fake instructions) got through 0 of 6 times. Faces and passwords stay on device; exported images carry no EXIF.
- Usefulness: task-necessity check passed 1 of 1 (small sample, say so).
- What is different: most redaction tools only hide what they can read; Google Cloud DLP, for one, returns the image unchanged when it detects nothing. (Keep the "we black it out anyway" sentence only if the backstop stays enabled.)
- Cost: open-weight models without a private frontier model.
- Who needs it: ISRO, government, banks, hospitals, defence. DPDP Rules list masking as a required safeguard, enforceable from 13 May 2027. A community PyPI package, bhoonidhi-mcp, already lets agents log in to Bhoonidhi.
- Line under the visuals: small, hand-built, English-language tests; public benchmarks (REDACT) are next.

## Slide 6
Add a QR code to the GitHub repo in the empty right half.
