import { z } from "zod";
import { RegionListSchema, RedactionManifestSchema, AgentActionSchema } from "@sentrylens/shared";

export const Msg = {
  PING: "PING",
  COLLECT_REGIONS: "COLLECT_REGIONS",
  RUN_PERCEPTION: "RUN_PERCEPTION",
  RESOLVE_ACTION: "RESOLVE_ACTION",
  EXECUTE_ACTION: "EXECUTE_ACTION",
  AGENT_START: "AGENT_START",
  AGENT_EVENT: "AGENT_EVENT",
  SET_FIREWALL: "SET_FIREWALL",
} as const;

export const CollectRegionsResult = z.object({
  regionList: RegionListSchema,
  domSensitive: z.array(z.object({ bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]), category: z.string() })),
});
export const RunPerceptionResult = z.object({
  sanitizedPng: z.string(),
  manifest: RedactionManifestSchema,
  screenSummary: z.string().optional(),
  degraded: z.boolean(),
});
export const ResolveActionArgs = z.object({ action: AgentActionSchema });
export const ExecuteActionArgs = z.object({ action: AgentActionSchema });
export const ExecuteActionResult = z.object({ ok: z.boolean(), observation: z.string() });
