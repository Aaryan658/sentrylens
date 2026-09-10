export const ALLOWLIST = [
  "huggingface.co", "cdn-lfs.huggingface.co", "cdn-lfs-us-1.huggingface.co",
  "cdn.jsdelivr.net", "storage.googleapis.com", "unpkg.com", "localhost",
] as const;

type Rule = chrome.declarativeNetRequest.Rule;

export function buildBlockRules(): Rule[] {
  const block = {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: { urlFilter: "*" },
  } as unknown as Rule;
  const allow: Rule[] = ALLOWLIST.map((host, i) => ({
    id: 100 + i,
    priority: 10,
    action: { type: "allow" },
    condition: { requestDomains: [host] },
  }) as unknown as Rule);
  return [block, ...allow];
}

export async function setFirewall(on: boolean): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: on ? buildBlockRules() : [],
  });
}
