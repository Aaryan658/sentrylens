import { AgentActionSchema, type AgentAction } from "@sentrylens/shared";

export type ParseResult =
  | { ok: true; action: AgentAction }
  | { ok: false; needsRepair: true };

function extractJson(raw: string): string | null {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1]!.trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

export function parseAction(raw: string): ParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, needsRepair: true };
  try {
    const parsed = AgentActionSchema.safeParse(JSON.parse(json));
    return parsed.success ? { ok: true, action: parsed.data } : { ok: false, needsRepair: true };
  } catch {
    return { ok: false, needsRepair: true };
  }
}
