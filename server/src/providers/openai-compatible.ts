export interface ChatArgs {
  system: string;
  user: string;
  imageB64: string; // raw base64 (no data: prefix) or a data URL
  model: string;
  baseUrl: string;
  apiKey: string;
}

export async function chatVision(a: ChatArgs): Promise<string> {
  const imageUrl = a.imageB64.startsWith("data:") ? a.imageB64 : `data:image/png;base64,${a.imageB64}`;
  const res = await fetch(`${a.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${a.apiKey}`,
      "http-referer": "https://sentrylens.local",
      "x-title": "SentryLens",
    },
    body: JSON.stringify({
      model: a.model,
      temperature: 0,
      messages: [
        { role: "system", content: a.system },
        { role: "user", content: [
          { type: "text", text: a.user },
          { type: "image_url", image_url: { url: imageUrl } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`provider ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0]?.message?.content ?? "";
}
