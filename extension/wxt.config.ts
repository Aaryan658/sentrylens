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
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
