import type { BBox } from "@sentrylens/shared";
import { findStructuredPii, findStructuredPiiDespaced } from "./validators.js";
import { findLabeledNames } from "./names.js";
import { findSuspectNumericRuns, findSuspectEmailFragments } from "./suspect.js";
import type { MappingTable } from "./mapping.js";

/**
 * The manifest sends every interactable element's DOM accessible name to the
 * server. Masking the pixels does nothing about that channel: a link
 * "Call 9000000000", an account button "john.doe@mail.com" or a contenteditable
 * compose box (its innerText is the typed text) would go out in clear text next
 * to a perfectly masked screenshot. This scrubs a name with the same detectors
 * the image path uses and swaps each sensitive span for the placeholder the
 * agent already uses for that value, so it can still refer to it.
 *
 * Limit, stated plainly: this recognises structured identifiers, label-anchored
 * names and misread-looking identifiers. A bare person name in a control's text
 * ("John Doe" on an account button) has no structure to detect and is not
 * caught here; on-device NER is not run over element names.
 */
interface Span { start: number; end: number; repl: string }

export function scrubElementText(text: string, mapping: MappingTable): string {
  if (!text) return text;
  const spans: Span[] = [];

  for (const h of [...findStructuredPii(text), ...findStructuredPiiDespaced(text)]) {
    spans.push({ start: h.start, end: h.end, repl: mapping.placeholderFor(h.category, h.value) });
  }
  for (const h of findLabeledNames(text)) {
    spans.push({ start: h.start, end: h.end, repl: mapping.placeholderFor(h.category, h.value) });
  }
  // Reuse the OCR-word misread detectors by laying the text's words out on one
  // row where x is the character index, so a returned box maps straight back
  // to a character range.
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], bbox: [m.index!, 0, m[0].length, 12] as BBox }));
  for (const b of [...findSuspectNumericRuns(words), ...findSuspectEmailFragments(words)]) {
    spans.push({ start: b[0], end: b[0] + b[2], repl: "[REDACTED]" });
  }
  if (spans.length === 0) return text;

  // Longest span first wins where spans overlap; then apply right to left.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  for (const s of spans) {
    const last = kept[kept.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) last.end = s.end; // extend to cover both
      continue;
    }
    kept.push({ ...s });
  }
  let out = text;
  for (const s of kept.reverse()) out = out.slice(0, s.start) + s.repl + out.slice(s.end);
  return out;
}
