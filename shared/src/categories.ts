export const PII_CATEGORIES = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB",
  "CREDIT_CARD", "AADHAAR", "PAN", "IFSC", "BANK_ACCOUNT", "PASSWORD",
  "API_KEY", "IP_ADDRESS", "FACE", "GOV_ID", "BYSTANDER_SCREEN", "OTHER",
] as const;

export type PiiCategory = (typeof PII_CATEGORIES)[number];

export type Risk = "high" | "medium" | "low";

const HIGH: PiiCategory[] = ["PASSWORD", "CREDIT_CARD", "AADHAAR", "PAN", "GOV_ID", "API_KEY"];
const MEDIUM: PiiCategory[] = [
  "PERSON_NAME", "EMAIL", "PHONE_NUMBER", "ADDRESS", "DOB", "BANK_ACCOUNT",
  "FACE", "IFSC", "BYSTANDER_SCREEN",
];

export function defaultRisk(category: PiiCategory): Risk {
  if (HIGH.includes(category)) return "high";
  if (MEDIUM.includes(category)) return "medium";
  return "low";
}

export function defaultStyle(risk: Risk): "blackbox" | "pixelate" | "blur" {
  return risk === "low" ? "pixelate" : "blackbox";
}
