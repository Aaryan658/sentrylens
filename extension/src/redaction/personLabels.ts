// Labels that, when immediately followed by a capitalized name-shaped span
// (in a DOM table cell, or in OCR'd screen text), reliably indicate the
// following text is a person's name. Shared by dom/walk.ts (DOM table-row
// fallback) and redaction/names.ts (OCR-text fallback) — both exist because
// the on-device NER model's recall is inconsistent on this exact shape: a
// live probe against onnx-community/multilang-pii-ner-ONNX found it tags
// "A. Menon" correctly in isolation but returns zero entities once a label
// like "Operator" precedes it, or once the text is embedded in a realistic
// multi-field OCR string (see docs/EVAL_RESULTS.md).
export const PERSON_LABELS: readonly string[] = [
  "operator", "name", "full name", "employee", "employee name", "patient",
  "patient name", "owner", "contact", "contact name", "signed by",
  "authorized by", "reported by", "assigned to", "customer", "customer name",
  "user", "account holder", "cardholder", "cardholder name", "passenger",
  "applicant", "student", "student name", "next of kin", "beneficiary",
];
