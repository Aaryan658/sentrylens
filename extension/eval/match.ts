import type { PiiCategory } from "@sentrylens/shared";

const NUMERIC: PiiCategory[] = ["PHONE_NUMBER", "AADHAAR", "CREDIT_CARD", "BANK_ACCOUNT", "IP_ADDRESS", "GOV_ID"];

// Mirrors redaction/mapping.ts's normalise() (numeric categories compare by
// digits only, everything else by trimmed/lowercased/whitespace-collapsed
// text) so a ground-truth value matches a mapping-resolved value the same
// way the mapping table itself would treat them as "the same entity".
export function matchValue(resolved: string, groundTruth: string, category: PiiCategory): boolean {
  if (NUMERIC.includes(category)) {
    return resolved.replace(/\D/g, "") === groundTruth.replace(/\D/g, "");
  }
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(resolved) === norm(groundTruth);
}
