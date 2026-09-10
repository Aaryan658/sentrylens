import { describe, it, expect } from "vitest";
import { mockRespond } from "./mock.js";
import type { ServerRequest, StepRecord } from "@sentrylens/shared";

const base: ServerRequest = {
  task: "log in as the operator and open the telemetry report",
  image_b64: "x",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 100, h: 100, dpr: 1 },
    regions: [
      { id: 1, kind: "element", role: "textbox", text: "Operator ID", interactable: true, bbox: [0, 0, 10, 10] },
      { id: 2, kind: "element", role: "textbox", text: "Password", interactable: true, bbox: [0, 20, 10, 10] },
      { id: 3, kind: "element", role: "button", text: "Sign in", interactable: true, bbox: [0, 40, 10, 10] },
      {
        id: 10000, kind: "redacted", category: "PASSWORD", placeholder: "PASSWORD#1", value_len: null,
        risk: "high", style: "blackbox", task_necessary: false, detected_by: ["dom"], bbox: [0, 20, 10, 10],
      },
    ],
    notes: "n",
  } as ServerRequest["manifest"],
  history: [],
};

const step = (a: StepRecord["action"]): StepRecord => ({ action: a, observation: "ok" });

describe("mockRespond — login flow", () => {
  it("first types the operator id into the username field", () => {
    const a = mockRespond(base);
    expect(a).toMatchObject({ type: "type", target_id: 1 });
  });

  it("types the password field using the redacted placeholder, never a real value", () => {
    const a = mockRespond({ ...base, history: [step({ type: "type", target_id: 1, value: "operator-42", thought: "" })] });
    expect(a).toMatchObject({ type: "type", target_id: 2, value: "PASSWORD#1" });
  });

  it("clicks submit once both fields are filled", () => {
    const a = mockRespond({
      ...base,
      history: [
        step({ type: "type", target_id: 1, value: "operator-42", thought: "" }),
        step({ type: "type", target_id: 2, value: "PASSWORD#1", thought: "" }),
      ],
    });
    expect(a).toMatchObject({ type: "click", target_id: 3 });
  });

  it("finishes with done once the flow is exhausted", () => {
    const a = mockRespond({
      ...base,
      history: [
        step({ type: "type", target_id: 1, value: "operator-42", thought: "" }),
        step({ type: "type", target_id: 2, value: "PASSWORD#1", thought: "" }),
        step({ type: "click", target_id: 3, thought: "" }),
      ],
    });
    expect(a.type).toBe("done");
  });

  it("fails cleanly when there is nothing to interact with", () => {
    const a = mockRespond({
      ...base,
      manifest: { ...base.manifest, regions: [] } as ServerRequest["manifest"],
    });
    expect(a.type).toBe("fail");
  });
});
