"use client";

import { decodeMono, SPEECH_RATE } from "./media";

/**
 * Volume profissional da voz. As redes tocam vídeo falado perto de −14 LUFS;
 * gravação de celular costuma chegar 8 a 12 dB abaixo disso, e o vídeo sai
 * "baixo" no feed. Medimos o nível da fala (só onde há fala) e calculamos o
 * ganho para o alvo; uma compressão leve segura os picos. O mesmo ganho vale
 * no preview e na exportação.
 */
const TARGET_DB = -16.5;
const gains = new Map<string, number>();
const pending = new Map<string, Promise<number>>();

/** Nível médio da fala em dBFS, ignorando silêncio (janelas de 400 ms com gate). */
export function speechLevelDb(samples: Float32Array, sampleRate: number): number | null {
  const win = Math.round(sampleRate * 0.4);
  const powers: number[] = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += samples[j]! * samples[j]!;
    powers.push(sum / win);
  }
  const loud = powers.filter((p) => p > 1e-5);
  if (!loud.length) return null;
  // Gate relativo: fica o que está a até 12 dB da média das janelas com som.
  const mean = loud.reduce((a, b) => a + b, 0) / loud.length;
  const gated = loud.filter((p) => p > mean * Math.pow(10, -12 / 10));
  const power = gated.reduce((a, b) => a + b, 0) / gated.length;
  return 10 * Math.log10(power);
}

export function voiceGain(assetId: string): Promise<number> {
  let p = pending.get(assetId);
  if (!p) {
    p = decodeMono(assetId)
      .then((samples) => {
        const level = speechLevelDb(samples, SPEECH_RATE);
        // Nunca atenua muito nem amplifica ruído de uma gravação quase muda.
        const db = level === null ? 0 : Math.min(18, Math.max(-6, TARGET_DB - level));
        const gain = Math.pow(10, db / 20);
        gains.set(assetId, gain);
        return gain;
      })
      .catch(() => 1);
    pending.set(assetId, p);
  }
  return p;
}

/** Ganho já calculado (1 enquanto a medição não termina; a medição é disparada). */
export function voiceGainNow(assetId: string): number {
  if (!gains.has(assetId)) void voiceGain(assetId);
  return gains.get(assetId) ?? 1;
}

/** Compressão leve de voz: segura os picos depois do ganho, sem "bombear". */
export function voiceCompressor(ctx: BaseAudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -14;
  c.knee.value = 10;
  c.ratio.value = 3;
  c.attack.value = 0.005;
  c.release.value = 0.16;
  return c;
}
