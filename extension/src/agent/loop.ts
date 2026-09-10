import type { AgentAction, RedactionManifest, StepRecord } from "@sentrylens/shared";

export interface PerceiveResult {
  sanitizedPng: string; manifest: RedactionManifest; degraded: boolean; screenSummary?: string;
}

export interface AgentDeps {
  perceive: (newSession: boolean) => Promise<PerceiveResult>;
  askServer: (task: string, p: PerceiveResult, history: StepRecord[]) => Promise<{ action: AgentAction }>;
  resolve: (a: AgentAction) => Promise<AgentAction>;
  execute: (a: AgentAction) => Promise<{ ok: boolean; observation: string }>;
  emit: (evt: { step: number; action: AgentAction; observation: string; perceive: PerceiveResult }) => void;
}

export interface AgentResult { status: "done" | "fail"; history: StepRecord[] }

export async function runAgent(task: string, deps: AgentDeps, opts: { maxSteps: number }): Promise<AgentResult> {
  const history: StepRecord[] = [];
  let notFoundStreak = 0;

  for (let step = 1; step <= opts.maxSteps; step++) {
    const perceive = await deps.perceive(step === 1);
    const { action: rawAction } = await deps.askServer(task, perceive, history);
    const action = await deps.resolve(rawAction);
    const { ok, observation } = await deps.execute(action);

    history.push({ action: rawAction, observation });
    deps.emit({ step, action: rawAction, observation, perceive });

    if (action.type === "done") return { status: "done", history };
    if (action.type === "fail") return { status: "fail", history };

    notFoundStreak = !ok && /not found/.test(observation) ? notFoundStreak + 1 : 0;
    if (notFoundStreak >= 2) return { status: "fail", history };
  }
  history.push({ action: { type: "fail", reason: "step budget exceeded", thought: "" }, observation: "budget" });
  return { status: "fail", history };
}
