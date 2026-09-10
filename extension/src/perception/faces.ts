import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";

let detector: FaceDetector | null = null;

export async function initFaces(): Promise<void> {
  if (detector) return;
  const files = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm",
  );
  detector = await FaceDetector.createFromOptions(files, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
    },
    runningMode: "IMAGE",
  });
}

export async function runFaces(bitmap: ImageBitmap): Promise<[number, number, number, number][]> {
  if (!detector) await initFaces();
  const res = detector!.detect(bitmap);
  return res.detections.map((d) => {
    const b = d.boundingBox!;
    return [b.originX, b.originY, b.width, b.height] as [number, number, number, number];
  });
}
