import { useEffect, useState } from "react";
import { Msg } from "../../src/messaging";

interface StepView { step: number; thought: string; action: string; observation: string; sanitizedPng: string; manifest: unknown; summary?: string }
interface NetRow { host: string; bytes: number; blocked?: boolean }

export function App() {
  const [task, setTask] = useState("log in as the operator and open the telemetry report for station VSSC-03");
  const [steps, setSteps] = useState<StepView[]>([]);
  const [net, setNet] = useState<NetRow[]>([]);
  const [running, setRunning] = useState(false);
  const [firewall, setFw] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const handler = (m: any) => {
      if (m?.type !== Msg.AGENT_EVENT) return;
      if (m.payload.kind === "step") setSteps((s) => [...s, m.payload.step as StepView]);
      if (m.payload.kind === "net") setNet((n) => [...n, m.payload as NetRow]);
      if (m.payload.kind === "end") { setRunning(false); setStatus(m.payload.status); }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  async function toggleFirewall(on: boolean) {
    setFw(on);
    await chrome.runtime.sendMessage({ type: Msg.SET_FIREWALL, payload: { on } });
  }

  async function start() {
    setSteps([]); setNet([]); setStatus(""); setRunning(true);
    await chrome.runtime.sendMessage({ type: Msg.AGENT_START, payload: { task } });
  }

  return (
    <div style={{ font: "13px system-ui", padding: 12, display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>SentryLens</h3>
      <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button disabled={running} onClick={start}>{running ? "Running…" : "Run task"}</button>
        <label><input type="checkbox" checked={firewall} onChange={(e) => toggleFirewall(e.target.checked)} /> Network firewall</label>
        {status && <b>{status}</b>}
      </div>

      {net.length > 0 && (
        <details open>
          <summary>Network ({net.length})</summary>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {net.map((n, i) => <li key={i} style={{ color: n.blocked ? "#b00" : "#333" }}>{n.host} — {n.bytes} B {n.blocked ? "(blocked)" : ""}</li>)}
          </ul>
        </details>
      )}

      {steps.map((s) => (
        <div key={s.step} style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8 }}>
          <div><b>Step {s.step}</b> — {s.action}</div>
          {s.summary && <div style={{ color: "#268" }}>👁 {s.summary}</div>}
          <div style={{ color: "#555" }}>{s.thought}</div>
          <div style={{ color: "#777" }}>→ {s.observation}</div>
          <details>
            <summary>What the server saw</summary>
            <img src={s.sanitizedPng} style={{ maxWidth: "100%", border: "1px solid #ccc" }} />
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{JSON.stringify(s.manifest, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
