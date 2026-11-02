import { describe, it, expect, beforeAll } from "vitest";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let base: string;

beforeAll(async () => {
  process.env.MOCK = "1";
  const { app } = await import("./index.js");
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

const body = {
  task: "log in",
  image_b64: "AAAA",
  manifest: {
    schema: "sentrylens-redaction/1.0",
    image: { w: 10, h: 10, dpr: 1 },
    regions: [{ id: 1, kind: "element", role: "button", text: "Login", interactable: true, bbox: [0, 0, 5, 5] }],
    notes: "n",
  },
  history: [],
};

describe("POST /agent/step (mock mode)", () => {
  it("returns a valid AgentAction referencing a real element id", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.action.type).toBe("click");
    expect(j.action.target_id).toBe(1);
  });

  it("saves exactly what the server received (manifest + image) when SENTRYLENS_CAPTURE_DIR is set, and nothing otherwise", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-capture-"));
    try {
      const post = () => fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, image_b64: "data:image/png;base64,iVBORw0KGgo=" }) });
      await post();
      expect(readdirSync(dir)).toEqual([]); // off by default

      process.env.SENTRYLENS_CAPTURE_DIR = dir;
      await post();
      const files = readdirSync(dir).sort();
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
      expect(files.filter((f) => f.endsWith(".png"))).toHaveLength(1);
      const saved = JSON.parse(readFileSync(join(dir, files.find((f) => f.endsWith(".json"))!), "utf8"));
      expect(saved.task).toBe("log in");
      expect(saved.manifest.regions[0].text).toBe("Login");
      expect(readFileSync(join(dir, files.find((f) => f.endsWith(".png"))!)).subarray(0, 4).toString("hex")).toBe("89504e47"); // PNG magic
    } finally {
      delete process.env.SENTRYLENS_CAPTURE_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("400s on a malformed body", async () => {
    const r = await fetch(`${base}/agent/step`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nope: true }) });
    expect(r.status).toBe(400);
  });
});
