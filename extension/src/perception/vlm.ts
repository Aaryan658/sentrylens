import "./env.js";
import { AutoProcessor, AutoModelForVision2Seq, RawImage } from "@huggingface/transformers";

let processor: any = null;
let model: any = null;

export async function initVlm(): Promise<void> {
  if (model) return;
  processor = await AutoProcessor.from_pretrained("HuggingFaceTB/SmolVLM-256M-Instruct");
  model = await AutoModelForVision2Seq.from_pretrained("HuggingFaceTB/SmolVLM-256M-Instruct", {
    dtype: "q4f16", device: "webgpu",
  });
}

export async function screenSummary(pngDataUrl: string): Promise<string> {
  if (!model) return "";
  const image = await RawImage.fromURL(pngDataUrl);
  const messages = [
    { role: "user", content: [{ type: "image" }, { type: "text", text: "In one sentence, what screen is this and what can the user do here?" }] },
  ];
  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(prompt, [image]);
  const ids = await model.generate({ ...inputs, max_new_tokens: 48, do_sample: false });
  const text = processor.batch_decode(ids, { skip_special_tokens: true })[0] as string;
  return text.split("Assistant:").pop()!.trim().slice(0, 200);
}
