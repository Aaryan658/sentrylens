import type { PiiCategory } from "@sentrylens/shared";

export interface StructuredHit {
  category: PiiCategory;
  value: string;
  start: number;
  end: number;
}

export function luhnValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Verhoeff checksum (used by Aadhaar). Tables per the standard.
const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

export function verhoeffValid(input: string): boolean {
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D[c]![P[i % 8]![Number(reversed[i])]!]!;
  }
  return c === 0;
}

interface Rule { category: PiiCategory; re: RegExp; check?: (m: string) => boolean }

const RULES: Rule[] = [
  { category: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { category: "PAN", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { category: "IFSC", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { category: "IP_ADDRESS", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { category: "CREDIT_CARD", re: /\b(?:\d[ -]?){13,19}\b/g, check: luhnValid },
  { category: "AADHAAR", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, check: verhoeffValid },
  { category: "PHONE_NUMBER", re: /(?:\+91[- ]?)?\b[6-9]\d{9}\b|\+\d{1,3}[- ]?\d{6,12}/g },
  { category: "API_KEY", re: /\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{16,}\b/g },
];

export function findStructuredPii(text: string): StructuredHit[] {
  const hits: StructuredHit[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const value = m[0];
      if (rule.check && !rule.check(value)) continue;
      hits.push({ category: rule.category, value, start: m.index, end: m.index + value.length });
    }
  }
  return hits;
}
