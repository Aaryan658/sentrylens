import type { PiiCategory } from "@sentrylens/shared";

const NUMERIC: PiiCategory[] = ["PHONE_NUMBER", "AADHAAR", "CREDIT_CARD", "BANK_ACCOUNT", "IP_ADDRESS", "GOV_ID"];

function normalise(category: PiiCategory, value: string): string {
  if (NUMERIC.includes(category)) return value.replace(/\D/g, "");
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[m]![n]!;
}

function b32(bytes: Uint8Array, len: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let out = "", bits = 0, val = 0;
  for (const byte of bytes) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += alphabet[(val >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= len) break;
  }
  return out.slice(0, len);
}

/**
 * Session-scoped, deterministic-within-session mapping between real values and
 * anonymised placeholders. Keyed by random session bytes so placeholders are
 * unlinkable across runs. Uses a fast non-crypto keyed hash: the goal is
 * cross-session unlinkability, not resistance to an attacker who already owns
 * the device (they can read the table itself). The table never leaves the
 * offscreen document.
 */
export class MappingTable {
  private readonly seed = crypto.getRandomValues(new Uint32Array(4));
  private readonly byPlaceholder = new Map<string, string>();      // placeholder -> value
  private readonly byNorm = new Map<string, string>();             // normValue  -> placeholder

  private hash5(category: PiiCategory, norm: string): string {
    let h0 = this.seed[0]! ^ 0x9e3779b9, h1 = this.seed[1]! ^ 0x85ebca6b;
    const s = `${category}:${norm}`;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h0 = Math.imul(h0 ^ c, 2654435761) >>> 0;
      h1 = Math.imul(h1 ^ c, 1597334677) >>> 0;
    }
    const bytes = new Uint8Array([h0 & 255, (h0 >>> 8) & 255, (h0 >>> 16) & 255, h1 & 255, (h1 >>> 8) & 255, (h1 >>> 16) & 255]);
    return b32(bytes, 5);
  }

  placeholderFor(category: PiiCategory, value: string): string {
    const norm = normalise(category, value);
    const existing = this.byNorm.get(norm);
    if (existing) return existing;
    for (const [k, p] of this.byNorm) {
      if (Math.abs(k.length - norm.length) <= 2 && levenshtein(k, norm) <= 2 && p.startsWith(category + "#")) {
        this.byNorm.set(norm, p);
        return p;
      }
    }
    const placeholder = `${category}#${this.hash5(category, norm)}`;
    this.byNorm.set(norm, placeholder);
    this.byPlaceholder.set(placeholder, value.trim());
    return placeholder;
  }

  resolve(placeholder: string): string | undefined {
    return this.byPlaceholder.get(placeholder);
  }

  resolveAll(text: string): string {
    return text.replace(/[A-Z_]+#[a-z0-9]{5}/g, (m) => this.byPlaceholder.get(m) ?? m);
  }

  clear(): void {
    this.byPlaceholder.clear();
    this.byNorm.clear();
  }
}
