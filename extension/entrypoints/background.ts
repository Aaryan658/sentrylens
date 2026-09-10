import { Msg } from "../src/messaging";
import { setFirewall } from "../src/firewall";

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

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === Msg.SET_FIREWALL) {
    setFirewall(!!msg.payload.on).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
