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

const failAction = (reason: string): AgentAction => ({ type: "fail", reason, thought: "" });

export async function runAgent(task: string, deps: AgentDeps, opts: { maxSteps: number }): Promise<AgentResult> {
  const history: StepRecord[] = [];
  let notFoundStreak = 0;

  for (let step = 1; step <= opts.maxSteps; step++) {
    let perceive: PerceiveResult;
    try {
      perceive = await deps.perceive(step === 1);
    } catch (e) {
      history.push({ action: failAction(`perception failed: ${String(e)}`), observation: "perception error" });
      return { status: "fail", history };
    }

    // Degraded means an on-device model failed or is not cached yet, so only
    // page-marked (DOM) redaction ran and PII visible only in pixels was NOT
    // hidden. Fail closed: send nothing rather than a weaker mask.
    if (perceive.degraded) {
      const reason = "on-device perception is degraded (models failed or are still loading); nothing was sent. Retry once the models have loaded";
      const a = failAction(reason);
      history.push({ action: a, observation: "perception degraded" });
      deps.emit({ step, action: a, observation: reason, perceive });
      return { status: "fail", history };
    }

    let rawAction: AgentAction | undefined;
    try {
      rawAction = (await deps.askServer(task, perceive, history)).action;
    } catch (e) {
      history.push({ action: failAction(`server call failed: ${String(e)}`), observation: "server error" });
      deps.emit({ step, action: failAction("server call failed"), observation: `${e}`, perceive });
      return { status: "fail", history };
    }
    if (!rawAction || typeof rawAction.type !== "string") {
      const a = failAction("server returned no valid action");
      history.push({ action: a, observation: "bad response" });
      deps.emit({ step, action: a, observation: "bad response", perceive });
      return { status: "fail", history };
    }

    let action: AgentAction;
    try {
      action = await deps.resolve(rawAction);
    } catch {
      action = rawAction;
    }

    let ok = false;
    let observation = "execute failed";
    try {
      ({ ok, observation } = await deps.execute(action));
    } catch (e) {
      observation = `execute threw: ${String(e)}`;
    }

    history.push({ action: rawAction, observation });
    deps.emit({ step, action: rawAction, observation, perceive });

    if (action.type === "done") return { status: "done", history };
    if (action.type === "fail") return { status: "fail", history };

    notFoundStreak = !ok && /not found/.test(observation) ? notFoundStreak + 1 : 0;
    if (notFoundStreak >= 2) return { status: "fail", history };
  }
  history.push({ action: failAction("step budget exceeded"), observation: "budget" });
  return { status: "fail", history };
}
