import { configureTransformers } from "./env.js";
import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

let model: any = null;
let processor: any = null;

export async function initDetector(device: "webgpu" | "wasm" | "cpu"): Promise<void> {
  if (model) return;
  configureTransformers();
  processor = await AutoProcessor.from_pretrained("Xenova/yolos-tiny");
  model = await AutoModel.from_pretrained("Xenova/yolos-tiny", { device, dtype: "q8" });
}

export interface DetBox { label: string; bbox: [number, number, number, number]; score: number }

export async function runDetector(pngDataUrl: string): Promise<DetBox[]> {
  if (!model) return [];
  const image = await RawImage.fromURL(pngDataUrl);
  const inputs = await processor(image);
  const outputs = await model(inputs);
  // transformers.js v3 moved post-processing onto the nested image processor.
  const ip = processor.image_processor ?? processor.feature_extractor ?? processor;
  const processed = ip.post_process_object_detection(outputs, 0.5, [[image.height, image.width]])[0];
  return processed.boxes.map((box: [number, number, number, number], i: number) => ({
    label: model.config.id2label[processed.classes[i]],
    bbox: [box[0], box[1], box[2] - box[0], box[3] - box[1]] as [number, number, number, number],
    score: processed.scores[i],
  }));
}
