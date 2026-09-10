import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "SentryLens",
    description: "On-device visual perception for privacy-preserving browser agents",
    permissions: ["offscreen", "tabs", "scripting", "storage", "activeTab", "sidePanel", "declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
    side_panel: { default_path: "sidepanel.html" },
    content_security_policy: {
      // script/wasm stay local (MV3 forbids remote code). connect-src is opened
      // for model *weights* (HF, mediapipe .tflite, jsdelivr) and the agent
      // server (localhost in dev, any https host once deployed).
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; " +
        "object-src 'self'; " +
        "worker-src 'self'; " +
        "connect-src 'self' data: blob: http://localhost:* http://127.0.0.1:* https://*;",
    },
  },
});
