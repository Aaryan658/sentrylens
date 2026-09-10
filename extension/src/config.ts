// The agent server URL. Defaults to a local dev server; override at build time
// to point the built extension at a hosted deployment, e.g.
//   WXT_SERVER_URL=https://sentrylens.vercel.app pnpm --filter @sentrylens/extension build
const ENV_URL = (import.meta as { env?: Record<string, string | undefined> }).env?.WXT_SERVER_URL;

export const CFG = {
  serverUrl: (ENV_URL && ENV_URL.replace(/\/$/, "")) || "http://localhost:8787",
  maxSteps: 12,
};
