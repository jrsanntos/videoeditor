"use client";

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { refineMask } from "@videoeditor/renderer";

/**
 * Segmentação de pessoa (MediaPipe Selfie Segmentation) para o texto atrás do
 * apresentador. Roda no navegador, só nos quadros em que um componente pede,
 * e guarda as máscaras num cache por quadro de origem: rever um trecho ou
 * exportar depois do preview não segmenta de novo.
 */
const MODEL = "/mediapipe/selfie_segmenter.tflite";
const WASM = "/mediapipe/wasm";
const CACHE_LIMIT = 360;

let segmenter: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter | null> | null = null;
let failed = false;
const cache = new Map<string, OffscreenCanvas>();
/** Confiança (já suavizada) do último quadro segmentado de cada vídeo: base da suavização temporal. */
const previous = new Map<string, { frame: number; data: Float32Array; w: number; h: number }>();
/** Desfoque da borda alfa, em pixels do vídeo de origem. */
const FEATHER_PX = 1.75;

/** Carrega o modelo (uma vez). Devolve false se o navegador não consegue rodá-lo. */
export function ensureSegmenter(): Promise<boolean> {
  if (failed) return Promise.resolve(false);
  loading ??= (async () => {
    try {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const create = (delegate: "GPU" | "CPU") =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "IMAGE",
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      // GPU quando há WebGL; senão CPU (mais lento, mesmo resultado).
      segmenter = await create("GPU").catch(() => create("CPU"));
      return segmenter;
    } catch (e) {
      console.warn("segmentação de pessoa indisponível; o título fica sem o efeito de profundidade", e);
      failed = true;
      return null;
    }
  })();
  return loading.then((s) => s !== null);
}

/**
 * Máscara (alfa = pessoa) do quadro `image`, identificado por `key`. Síncrono:
 * devolve null enquanto o modelo não carregou — e dispara o carregamento.
 */
export function personMask(key: string, image: CanvasImageSource, width: number, height: number): OffscreenCanvas | null {
  const hit = cache.get(key);
  if (hit) return hit;
  if (!segmenter) {
    void ensureSegmenter();
    return null;
  }
  try {
    const result = segmenter.segment(image as TexImageSource);
    // O modelo selfie devolve uma máscara de confiança da pessoa; modelos multiclasse, a última é a do primeiro plano.
    const masks = result.confidenceMasks;
    const mask = masks?.[masks.length - 1];
    if (!mask) {
      result.close();
      return null;
    }
    const data = mask.getAsFloat32Array();
    const canvas = new OffscreenCanvas(mask.width, mask.height);
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(mask.width, mask.height);
    // Pós-processamento de estúdio: suavização temporal com o quadro anterior do mesmo vídeo (sem
    // tremor no cabelo e nos ombros), fechamento morfológico (sem buracos na silhueta) e feathering
    // de ~1,75 px na borda alfa.
    const [stream, frameStr] = key.split(":").length === 2 ? key.split(":") : [null, null];
    const frame = Number(frameStr);
    const last = stream ? previous.get(stream) : undefined;
    // Só quadros vizinhos contam: depois de um salto na timeline o quadro anterior é outra cena.
    const usable = last && last.w === mask.width && last.h === mask.height && Number.isFinite(frame) && Math.abs(frame - last.frame) <= 3 ? last.data : null;
    const { alpha, smoothed } = refineMask(data, mask.width, mask.height, { previous: usable, featherPx: FEATHER_PX, scale: mask.width / Math.max(width, 1) });
    if (stream && Number.isFinite(frame)) previous.set(stream, { frame, data: smoothed, w: mask.width, h: mask.height });
    let covered = 0;
    for (let i = 0; i < alpha.length; i++) {
      const v = alpha[i]!;
      if (v > 0.5) covered++;
      pixels.data[i * 4 + 3] = Math.round(v * 255);
    }
    ctx.putImageData(pixels, 0, 0);
    result.close();
    // Recorte que não achou ninguém (ou quase ninguém) não serve: quem pediu cai no plano B,
    // em vez de pôr um título "atrás" de uma pessoa que não foi recortada.
    if (covered < data.length * 0.04) return null;
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, canvas);
    return canvas;
  } catch (e) {
    console.warn("falha ao segmentar o quadro", e, width, height);
    return null;
  }
}

/** Chave de cache de um quadro: asset + instante de origem arredondado ao quadro. */
export const maskKey = (assetId: string, sourceTime: number, fps: number) => `${assetId}:${Math.round(sourceTime * fps)}`;

export function clearMaskCache() {
  cache.clear();
  previous.clear();
}
