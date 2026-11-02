import { describe, it, expect } from "vitest";
import { scrubElementText } from "./element-text.js";
import { MappingTable } from "./mapping.js";

describe("scrubElementText (DOM accessible names go to the server in the manifest, so they need the same scrubbing as pixels)", () => {
  it("leaves ordinary control names alone", () => {
    const m = new MappingTable();
    for (const name of ["Sign in", "Open VSSC-03 report", "Password", "Operator ID", "Submit payment", "Next page 2 of 9", ""]) {
      expect(scrubElementText(name, m)).toBe(name);
    }
  });

  it("replaces an email in a link/button name with the same placeholder the agent uses for it", () => {
    const m = new MappingTable();
    const out = scrubElementText("Signed in as john.doe@mail.com", m);
    expect(out).not.toContain("john.doe@mail.com");
    const ph = m.placeholderFor("EMAIL", "john.doe@mail.com");
    expect(out).toBe(`Signed in as ${ph}`);
    expect(m.resolve(ph)).toBe("john.doe@mail.com");
  });

  it("replaces phone, PAN and Aadhaar numbers inside a name", () => {
    const m = new MappingTable();
    expect(scrubElementText("Call 9000000000", m)).not.toContain("9000000000");
    expect(scrubElementText("PAN ABCDE1234F", m)).not.toContain("ABCDE1234F");
    expect(scrubElementText("Aadhaar 4321 5678 9003", m)).not.toContain("5678");
  });

  it("scrubs a label-anchored name", () => {
    const m = new MappingTable();
    const out = scrubElementText("Operator A. Menon", m);
    expect(out).not.toContain("Menon");
    expect(out.startsWith("Operator ")).toBe(true);
  });

  it("fails closed on a misread-looking identifier and an email fragment", () => {
    const m = new MappingTable();
    expect(scrubElementText("Card A111 1111111 1111", m)).toBe("Card [REDACTED]");
    expect(scrubElementText("Mail ops.lead@vssc test", m)).toBe("Mail [REDACTED]");
  });

  it("scrubs a bare person name, which has no structure to detect and which NER misses ('John Doe' returned nothing)", () => {
    const m = new MappingTable();
    for (const [text, name] of [
      ["John Doe", "John Doe"],
      ["Signed in as John Doe", "John Doe"],
      ["Priya Sharma", "Priya Sharma"],
      ["Account: Rahul Verma (Admin)", "Rahul Verma"],
      ["Dr. Anita Rao", "Anita Rao"],
    ] as const) {
      const out = scrubElementText(text, m);
      expect(out, text).not.toContain(name.split(" ")[0]!);
      expect(m.resolve(m.placeholderFor("PERSON_NAME", name))).toBe(name);
    }
  });

  it("keeps ordinary Title Case control text (stop-list of UI words), so agent grounding survives", () => {
    const m = new MappingTable();
    for (const name of ["Submit Payment", "Download Report", "Next Page", "Contact Support", "Account Settings", "Duty Roster", "Operator ID", "Sign in", "Open VSSC-03 report", "Privacy Policy", "Forgot Password"]) {
      expect(scrubElementText(name, m), name).toBe(name);
    }
  });

  it("scrubs several sensitive spans in one name without mangling the rest", () => {
    const m = new MappingTable();
    const out = scrubElementText("Contact ops.lead@vssc.test or 9000000000 today", m);
    expect(out).not.toContain("ops.lead@vssc.test");
    expect(out).not.toContain("9000000000");
    expect(out.startsWith("Contact ")).toBe(true);
    expect(out.endsWith(" today")).toBe(true);
  });
});
