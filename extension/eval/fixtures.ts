import type { BBox, PiiCategory, Region } from "@sentrylens/shared";

export interface GroundTruthPii {
  category: PiiCategory;
  /** Raw value as it appears on screen; matched via matchValue() against a mapping-resolved redacted region. */
  value: string;
  /** When set, also checked against the matching redacted region's task_necessary flag. */
  taskNecessary?: boolean;
}

export interface EvalFixture {
  name: string;
  svg: string;
  task: string;
  domRegions: Region[];
  domSensitive: { bbox: BBox; category: PiiCategory }[];
  /**
   * PII that SHOULD end up as a redacted region. Deliberately excludes
   * PASSWORD: DOM-flagged password fields carry value: null by design (see
   * pipeline.ts) — they get a positional placeholder, never a mapping-table
   * entry, so there is no "value" for this harness's leakage/over-masking
   * checks to compare against. Their pixel-level redaction is already
   * proven by mask.test.ts + perception-e2e.ts; this harness measures the
   * value-bearing manifest/mapping-table claim instead.
   */
  groundTruth: GroundTruthPii[];
}

function textSvg(width: number, height: number, lines: string[]): string {
  const body = lines.map((l, i) => `<text x="24" y="${44 + i * 40}">${l}</text>`).join("\n    ");
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <g font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#111111">
    ${body}
  </g>
</svg>`;
}

export const FIXTURES: EvalFixture[] = [
  {
    name: "duty-roster",
    task: "open the telemetry report for station VSSC-03",
    svg: textSvg(640, 340, [
      "Duty roster - station VSSC-03",
      "Operator    R. Iyer",
      "Phone       9123456780",
      "Email       r.iyer@vssc.test",
      "PAN         BNZAA2318K",
      "Password    skyfall99",
    ]),
    domRegions: [
      { id: 1, bbox: [24, 260, 220, 26], source: "dom", role: "textbox", name: "Password", interactable: true },
      { id: 2, bbox: [24, 300, 240, 26], source: "dom", role: "button", name: "Open VSSC-03 report", interactable: true },
    ],
    domSensitive: [{ bbox: [24, 260, 220, 26], category: "PASSWORD" }],
    groundTruth: [
      { category: "PERSON_NAME", value: "R. Iyer" },
      { category: "PHONE_NUMBER", value: "9123456780" },
      { category: "EMAIL", value: "r.iyer@vssc.test" },
      { category: "PAN", value: "BNZAA2318K" },
    ],
  },
  {
    name: "payment-form",
    task: "submit the payment for station VSSC-07",
    svg: textSvg(640, 300, [
      "Payment authorisation - station VSSC-07",
      "Beneficiary K. Bhatt",
      "Aadhaar     2341 2341 2346",
      "Card        4111 1111 1111 1111",
      "IFSC        SBIN0001234",
    ]),
    domRegions: [
      { id: 1, bbox: [24, 260, 200, 26], source: "dom", role: "button", name: "Submit payment", interactable: true },
    ],
    domSensitive: [],
    groundTruth: [
      { category: "PERSON_NAME", value: "K. Bhatt" },
      { category: "AADHAAR", value: "2341 2341 2346" },
      { category: "CREDIT_CARD", value: "4111 1111 1111 1111" },
      { category: "IFSC", value: "SBIN0001234" },
    ],
  },
  {
    // True negative: zero PII on screen. Any redacted region here is a pure
    // false positive — this fixture isolates the over-masking baseline.
    name: "public-announcement",
    task: "read the maintenance window announcement",
    svg: textSvg(640, 220, [
      "Maintenance window notice",
      "Telemetry dashboard offline",
      "from 0200 to 0400 IST Saturday",
      "No login required to view this notice",
    ]),
    domRegions: [],
    domSensitive: [],
    groundTruth: [],
  },
  {
    // Near-PII lookalikes that must NOT be redacted: an invalid-Luhn card
    // number, a ticket code that isn't phone/card/PAN/Aadhaar-shaped, and
    // generic role text (not a name). Any redaction here is an over-mask.
    name: "false-positive-bait",
    task: "note the ticket reference for the outage",
    svg: textSvg(640, 220, [
      "Ticket reference for outage RPT-2026-0913",
      "Sample invalid card 4111 1111 1111 1112",
      "Status Nominal, filed by Duty Engineer",
      "Category Routine Maintenance",
    ]),
    domRegions: [],
    domSensitive: [],
    groundTruth: [],
  },
  {
    // Task-grounding: the task names the operator the payment is FOR, so
    // classify() should mark that PERSON_NAME region task_necessary: true —
    // over-masking research (GUIGuard) warns this is exactly the case a
    // naive redactor gets wrong (hides the one detail the agent needs).
    name: "task-grounding",
    task: "submit payment for the operator on duty",
    svg: textSvg(640, 180, [
      "Approve payment for operator M. Rao",
      "Amount Rs 12000 pending confirmation",
    ]),
    domRegions: [
      // classify()'s task_necessary check requires an element whose bbox is
      // near/overlapping the redacted region AND whose name shares a task
      // token — it's spatial proximity, not "value appears in the task
      // string". This line-level region (same row as "M. Rao") makes that
      // condition real instead of assuming it.
      { id: 1, bbox: [24, 24, 600, 30], source: "dom", role: "text", name: "Approve payment for operator", interactable: false },
      { id: 2, bbox: [24, 120, 200, 26], source: "dom", role: "button", name: "Submit payment", interactable: true },
    ],
    domSensitive: [],
    groundTruth: [{ category: "PERSON_NAME", value: "M. Rao", taskNecessary: true }],
  },
];
