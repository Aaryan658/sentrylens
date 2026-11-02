import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import express, { type Express } from "express";
import { ServerRequestSchema, type ServerResponse } from "@sentrylens/shared";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { parseAction } from "./parse.js";
import { mockRespond } from "./providers/mock.js";
import { chatVision } from "./providers/openai-compatible.js";

// Minimal .env loader (no dependency). Reads server/.env if present; variables
// already set in the real environment always win. Lets `MOCK=1` etc. be set
// without shell-specific export syntax — PowerShell rejects `VAR=1 cmd`.
(() => {
  try {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      if (process.env[key] === undefined) process.env[key] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file — rely on the real environment */ }
})();

const app: Express = express();
app.use(express.json({ limit: "25mb" }));

const MOCK = process.env.MOCK === "1";

app.get("/health", (_req, res) => res.json({ ok: true, mock: MOCK }));

// Debug aid, off by default: with SENTRYLENS_CAPTURE_DIR set, save each request
// exactly as received (masked image as a PNG, plus task/manifest/history as JSON)
// so you can inspect what the server saw without browser DevTools. The image and
// manifest are already masked by the extension; nothing here un-masks anything.
function captureRequest(request: { task: string; image_b64: string; manifest: unknown; history: unknown }): void {
  const dir = process.env.SENTRYLENS_CAPTURE_DIR;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ task: request.task, manifest: request.manifest, history: request.history }, null, 2));
    writeFileSync(join(dir, `${stamp}.png`), Buffer.from(request.image_b64.replace(/^data:image\/\w+;base64,/, ""), "base64"));
  } catch (err) {
    console.warn("[sentrylens] capture failed:", err);
  }
}

app.post("/agent/step", async (req, res) => {
  const parsed = ServerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const request = parsed.data;
  captureRequest(request);

  if (MOCK) {
    const response: ServerResponse = { action: mockRespond(request), raw: "mock" };
    return res.json(response);
  }

  const user = buildUserPrompt(request.task, request.manifest, request.history);
  const cfg = {
    model: process.env.MODEL!, baseUrl: process.env.BASE_URL!, apiKey: process.env.API_KEY!,
  };
  try {
    let raw = await chatVision({ system: SYSTEM_PROMPT, user, imageB64: request.image_b64, ...cfg });
    let parsedAction = parseAction(raw);
    if (!parsedAction.ok) {
      raw = await chatVision({
        system: SYSTEM_PROMPT,
        user: `${user}\n\nYour previous reply was not a single valid JSON action. Resend ONLY the JSON object.`,
        imageB64: request.image_b64, ...cfg,
      });
      parsedAction = parseAction(raw);
    }
    const action = parsedAction.ok
      ? parsedAction.action
      : { type: "fail" as const, reason: "unparseable model output", thought: "server give-up" };
    const response: ServerResponse = { action, raw };
    res.json(response);
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// Only bind a port when run as the entrypoint (`tsx src/index.ts`), not when
// imported (tests import `app` and call `app.listen(0)` themselves).
const isEntrypoint = process.argv[1]?.replace(/\\/g, "/").endsWith("server/src/index.ts");
if (isEntrypoint) {
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => console.log(`sentrylens server on :${port} (mock=${MOCK})`));
}

export { app };
