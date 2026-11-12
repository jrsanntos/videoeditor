"use client";

import { decodeMono, SPEECH_RATE } from "./media";

/** Picos do áudio por asset (100 por segundo), para desenhar a forma de onda na timeline. */
export const PEAKS_PER_SEC = 100;
const peaks = new Map<string, Float32Array>();
const pending = new Map<string, Promise<void>>();

export const peaksFor = (assetId: string) => peaks.get(assetId) ?? null;

export function loadPeaks(assetId: string): Promise<void> {
  let p = pending.get(assetId);
  if (!p) {
    p = decodeMono(assetId)
      .then((samples) => {
        const win = SPEECH_RATE / PEAKS_PER_SEC;
        const out = new Float32Array(Math.ceil(samples.length / win));
        let max = 0;
        for (let i = 0; i < out.length; i++) {
          let peak = 0;
          const end = Math.min(samples.length, (i + 1) * win);
          for (let j = i * win; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]!));
          out[i] = peak;
          max = Math.max(max, peak);
        }
        if (max > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / max;
        peaks.set(assetId, out);
      })
      .catch(() => {
        // vídeo sem áudio legível: a trilha fica sem forma de onda
      });
    pending.set(assetId, p);
  }
  return p;
}
