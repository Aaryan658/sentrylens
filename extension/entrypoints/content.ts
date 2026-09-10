import { walkDom, domSensitiveRegions, collectInteractableElements } from "../src/dom/walk";
import { executeAction } from "../src/dom/execute";
import { Msg } from "../src/messaging";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === Msg.PING) {
        sendResponse({ pong: true });
        return true;
      }
      if (msg?.type === Msg.COLLECT_REGIONS) {
        const vp = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
        const map = new Map<number, Element>();
        collectInteractableElements().forEach((el, i) => map.set(i + 1, el));
        (window as any).__sentrylensRegions = map;
        sendResponse({ regionList: walkDom(location.href, vp), domSensitive: domSensitiveRegions() });
        return true;
      }
      if (msg?.type === Msg.EXECUTE_ACTION) {
        executeAction(msg.payload.action).then(sendResponse);
        return true;
      }
      return false;
    });
  },
});
