# Hosting SentryLens on Vercel

The **browser extension** is not hosted — it is loaded unpacked (`docs/DEMO.md`)
or published to the Chrome Web Store. What Vercel hosts is:

- the **agent server** (`server/`) as one serverless function at `/agent/step`
  and `/health` (via `api/index.ts` + `vercel.json` rewrites), and
- the **demo page** (`demo/`) as static hosting at `/`.

Both live on a single deployment URL, e.g. `https://sentrylens.vercel.app`.

## Deploy

1. Push this repo to GitHub/GitLab.
2. Vercel → **Add New… → Project** → import the repo.
3. Framework preset: **Other**. Leave **Root Directory** as the repo root
   (`vercel.json` handles the rest).
4. **Environment Variables** (Project Settings → Environment Variables):

   | Name | Value | Notes |
   |---|---|---|
   | `MOCK` | `1` | Deterministic offline mode — no external calls. Use this first. |
   | `MOCK` | `0` | Real VLM mode. Also set the four below. |
   | `PROVIDER` | `openrouter` | any label |
   | `BASE_URL` | `https://openrouter.ai/api/v1` | any OpenAI-compatible endpoint |
   | `MODEL` | `qwen/qwen2.5-vl-32b-instruct:free` | a vision model |
   | `API_KEY` | *your key* | never commit it |

5. **Deploy.**
6. Verify:
   - `https://<deployment>/health` → `{"ok":true,"mock":true}` (or `false`)
   - `https://<deployment>/` → the ISRO ops-console demo page
   - `POST https://<deployment>/agent/step` with a valid `ServerRequest` body
     → a `{ "action": … }` response (in `MOCK=1`, a `click`).

pnpm 11 is picked up from the `packageManager` field. `installCommand` in
`vercel.json` runs a workspace install so `@sentrylens/shared` resolves; the
function is bundled by Vercel's Node runtime (no build step).

## Point the extension at the hosted server

`extension/src/config.ts` reads an optional `WXT_SERVER_URL` build variable:

```bash
WXT_SERVER_URL=https://sentrylens.vercel.app pnpm --filter @sentrylens/extension build
```

Load the resulting `extension/.output/chrome-mv3` unpacked. The agent loop now
POSTs to the Vercel deployment instead of `localhost:8787`. Nothing else
changes — perception and redaction still run entirely on-device; only the
already-anonymised screenshot + manifest leave the browser.

No CORS config is needed: the MV3 service worker fetches with the extension's
`<all_urls>` host permission, which is not subject to CORS. If you also want to
call `/agent/step` from a normal web page, add a permissive
`Access-Control-Allow-Origin` in `server/src/index.ts`.

## Alternative: server-only project

If you only want the API (no demo page), set **Root Directory = `server`** in
Vercel and add a `server/vercel.json` with the same rewrites. Vercel still runs
the install at the workspace root when it detects `pnpm-workspace.yaml`, so the
`@sentrylens/shared` workspace dependency resolves.

## Local parity with the platform

```bash
pnpm i -g vercel
vercel dev            # serves demo/ + api/ exactly as the deployment does
```
