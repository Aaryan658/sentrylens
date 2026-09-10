import type { RedactionManifest, StepRecord } from "@sentrylens/shared";

export const SYSTEM_PROMPT =
  "You are SentryLens, a web agent operating on an ANONYMISED screenshot plus a JSON manifest. " +
  "Regions with kind=redacted are PII: you see category, position and value length, not the value. " +
  "Elements (kind=element) have a numeric id. Respond with EXACTLY ONE JSON object and nothing else, one of:\n" +
  '{"type":"click","target_id":<id>,"thought":"..."}\n' +
  '{"type":"type","target_id":<id>,"value":"<text or PLACEHOLDER>","thought":"..."}\n' +
  '{"type":"scroll","direction":"up|down","thought":"..."}\n' +
  '{"type":"done","answer":"...","thought":"..."}\n' +
  '{"type":"fail","reason":"...","thought":"..."}\n' +
  "For type actions, if the value should be a redacted item, output its placeholder verbatim " +
  "(e.g. PHONE_NUMBER#a1b2c). NEVER guess a redacted value.";

export function buildUserPrompt(task: string, manifest: RedactionManifest, history: StepRecord[]): string {
  const hist = history
    .map((h, i) => `#${i + 1} ${JSON.stringify(h.action)} -> ${h.observation}`)
    .join("\n") || "(none)";
  return [
    `TASK: ${task}`,
    `MANIFEST: ${JSON.stringify(manifest)}`,
    `HISTORY:\n${hist}`,
    "Return one JSON action now.",
  ].join("\n\n");
}
