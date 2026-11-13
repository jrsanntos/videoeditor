"use client";

import type { FaceDetector } from "@mediapipe/tasks-vision";

/**
 * Detector de rosto (MediaPipe BlazeFace, ~230 KB). A silhueta da pessoa diz
 * onde ela está; só o detector diz onde fica o ROSTO — num close-up de
 * celular os ombros saem do quadro e a estimativa pela silhueta erra a altura
 * da boca e do queixo, justamente onde os textos não podem ficar.
 */
const MODEL = "/mediapipe/blaze_face_short_range.tflite";
const WASM = "/mediapipe/wasm";

let detector: FaceDetector | null = null;
let loading: Promise<FaceDetector | null> | null = null;

export function ensureFaceDetector(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const create = (delegate: "GPU" | "CPU") => FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 });
      detector = await create("GPU").catch(() => create("CPU"));
      return detector;
    } catch (e) {
      console.warn("detector de rosto indisponível; o rosto é estimado pela silhueta", e);
      return null;
    }
  })();
  return loading.then((d) => d !== null);
}

/** Rosto mais confiável do quadro, em frações da imagem (0–1). null sem detector ou sem rosto. */
export function detectFace(image: HTMLVideoElement, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  if (!detector) return null;
  try {
    const best = detector
      .detect(image)
      .detections.filter((d) => d.boundingBox)
      .sort((a, b) => (b.categories[0]?.score ?? 0) - (a.categories[0]?.score ?? 0))[0];
    const box = best?.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: box.originX / width, y: box.originY / height, w: box.width / width, h: box.height / height };
  } catch (e) {
    console.warn("falha ao detectar o rosto", e);
    return null;
  }
}
