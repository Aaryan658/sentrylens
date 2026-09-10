import express, { type Express } from "express";
import { ServerRequestSchema, type ServerResponse } from "@sentrylens/shared";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { parseAction } from "./parse.js";
import { mockRespond } from "./providers/mock.js";
import { chatVision } from "./providers/openai-compatible.js";

const app: Express = express();
app.use(express.json({ limit: "25mb" }));

const MOCK = process.env.MOCK === "1";

app.get("/health", (_req, res) => res.json({ ok: true, mock: MOCK }));

app.post("/agent/step", async (req, res) => {
  const parsed = ServerRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const request = parsed.data;

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
