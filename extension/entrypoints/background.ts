import { Msg } from "../src/messaging";
import { setFirewall } from "../src/firewall";
import { runAgent } from "../src/agent/loop";
import { CFG } from "../src/config";

const OFFSCREEN_PATH = "offscreen.html";
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType] });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["WORKERS" as chrome.offscreen.Reason, "DOM_SCRAPING" as chrome.offscreen.Reason],
        justification: "Run WebGPU perception + OCR/NER models and canvas redaction off the main thread.",
      })
      .then(() => { creating = null; });
  }
  await creating;
}

async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab!.id!;
}

function emit(kind: string, payload: Record<string, unknown>) {
  chrome.runtime.sendMessage({ type: Msg.AGENT_EVENT, payload: { kind, ...payload } }).catch(() => {});
}

async function postStep(url: string, body: string) {
  emit("net", { host: new URL(url).host, bytes: body.length });
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  } catch (e) {
    throw new Error(`cannot reach agent server at ${url} — is it running? (${String(e)})`);
  }
  if (!r.ok) throw new Error(`agent server ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === Msg.SET_FIREWALL) {
      setFirewall(!!msg.payload.on).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (msg?.type === Msg.AGENT_START) {
      (async () => {
        let status = "fail";
        try {
          await ensureOffscreen();
          const tabId = await activeTabId();

          const res = await runAgent(msg.payload.task, {
            perceive: async (newSession) => {
              const png = await chrome.tabs.captureVisibleTab({ format: "png" });
              const collected = await chrome.tabs.sendMessage(tabId, { type: Msg.COLLECT_REGIONS });
              if (!collected?.regionList) throw new Error("content script did not respond — reload the target tab");
              const p = await chrome.runtime.sendMessage({
                target: "offscreen", type: Msg.RUN_PERCEPTION,
                payload: { png, regionList: collected.regionList, domSensitive: collected.domSensitive, task: msg.payload.task, newSession },
              });
              if (!p || p.error || !p.sanitizedPng) throw new Error(p?.error ?? "offscreen perception returned nothing");
              return p;
            },
            askServer: (task, p, history) =>
              postStep(`${CFG.serverUrl}/agent/step`, JSON.stringify({ task, image_b64: p.sanitizedPng, manifest: p.manifest, history })),
            resolve: async (action) => {
              const r = await chrome.runtime.sendMessage({ target: "offscreen", type: Msg.RESOLVE_ACTION, payload: { action } });
              return r?.action ?? action;
            },
            execute: (action) => chrome.tabs.sendMessage(tabId, { type: Msg.EXECUTE_ACTION, payload: { action } }),
            emit: ({ step, action, observation, perceive }) =>
              emit("step", { step: { step, thought: action.thought, action: JSON.stringify(action), observation, sanitizedPng: perceive.sanitizedPng, manifest: perceive.manifest, summary: perceive.screenSummary } }),
          }, { maxSteps: CFG.maxSteps });
          status = res.status;
        } catch (e) {
          console.error("[sentrylens] agent run failed:", e);
          emit("step", { step: { step: 0, thought: "", action: "{}", observation: `run failed: ${String(e)}`, sanitizedPng: "", manifest: {} } });
        } finally {
          emit("end", { status });
          try { sendResponse({ ok: true, status }); } catch { /* panel may be closed */ }
        }
      })();
      return true;
    }
    return false;
  });
});
