# SentryLens — Final Product Roadmap

Not an implementation plan itself — an index of the five independent subsystem
plans that together close the gaps found in the 2026-09-13 codebase audit
against `SIH26171_Deep_Research_Report.md`'s differentiators. Each subsystem
gets its own plan file (per `superpowers:writing-plans`'s scope-check: each
plan must produce working, testable software on its own) and is written
just-in-time, right before it's executed, so it reflects the actual code
state at that point rather than going stale.

User-confirmed priorities (2026-09-13): all five, no hard deadline pressure
this week, sequence by risk/value.

## Why these five, in this order

1. **`2026-09-13-housekeeping-and-yolos-wiring.md`** — commit the already-written,
   already-tested NER aggregation fix sitting uncommitted; turn the yolos-tiny
   detector from dead compute (runs, output discarded) into a real signal
   (bystander phone/laptop/tv screens, person-box fallback when MediaPipe
   finds zero faces). Small, low-risk, unblocks a clean tree for everything
   after it.
2. **Eval harness** (quantitative privacy-utility numbers) — the pitch deck
   currently cites literature numbers ("task success 80.8% vs 83.6%") as if
   they were SentryLens's own. Build a local synthetic benchmark + a script
   that computes PII leakage rate, over-masking rate, and task-grounding
   preservation on *this* system, so the deck can cite real numbers. This is
   the single highest-credibility-risk gap if an evaluator asks "is that your
   number or a citation?".
3. **Review overlay** — the deck's own risk-mitigation slide promises a
   "manual review overlay (toggle/add/remove boxes)" that does not exist.
   Requires deferring mask compositing until after an optional review step
   (new offscreen `RENDER_MASK` message, raw PNG kept in memory only) so
   removed regions can actually be un-redacted before the image is painted.
4. **Policy layer (Allow/Mask/Ask)** — MaskClaw-style per-site/per-category
   rule memory, named as differentiator #5 in the research report. Builds on
   #3's pause/resume plumbing (an "Ask" region reuses the review gate).
5. **Deployment reliability + connectivity/NFR hardening** — verify the
   Vercel deployment is actually live (manual checklist, not code — deploying
   is a publish action needing the user's own Vercel login); implement the
   promised-but-missing "server-down → on-device fallback answer" tier of
   the 3-tier degradation story; add a connectivity-loss test.

## Status

- [x] 1. Housekeeping + yolos wiring — done (7 commits, 85/85 tests, clean typecheck; live-Chrome smoke check for BYSTANDER_SCREEN left as a manual step, see plan Task 5 Step 3)
- [ ] 2. Eval harness
- [ ] 3. Review overlay
- [ ] 4. Policy layer
- [ ] 5. Deployment + connectivity hardening

Update this checklist as each subsystem plan is written and completed.
