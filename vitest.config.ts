import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "extension/src/**/*.test.ts", "extension/eval/**/*.test.ts"],
    environment: "node",
  },
});
