"use client";

import type { Asset, Word } from "@videoeditor/core";
import { ensureSegmenter, personMask } from "./segmentation";

/**
 * Análise local do vídeo, no navegador e sem custo: é o que dá "olhos e
 * ouvidos" ao agente. Nada aqui sobe para o servidor além dos números.
 */

/**
 * Energia da voz em cada palavra: RMS em dB, relativo à mediana do próprio
 * apresentador. +5 dB numa palavra = ela foi dita com força (ênfase real).
 */
export function wordEnergy(samples: Float32Array, sampleRate: number, words: Word[]): Word[] {
  const db = words.map((w) => {
    const a = Math.max(0, Math.floor(w.start * sampleRate));
    const b = Math.min(samples.length, Math.ceil(w.end * sampleRate));
    if (b - a < sampleRate * 0.02) return null;
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i]! * samples[i]!;
    const rms = Math.sqrt(sum / (b - a));
    return rms > 1e-5 ? 20 * Math.log10(rms) : null;
  });
  const valid = db.filter((v): v is number => v !== null).sort((x, y) => x - y);
  if (valid.length < 4) return words;
  const median = valid[Math.floor(valid.length / 2)]!;
  return words.map((w, i) => (db[i] === null ? w : { ...w, energy: Math.round((db[i]! - median) * 10) / 10 }));
}

type Subject = NonNullable<Asset["subject"]>[number];

/** Caixa do apresentador e centro estimado do rosto a partir da máscara de segmentação (alfa = pessoa). */
function subjectFromMask(mask: OffscreenCanvas, t: number): Subject | null {
  const { width: W, height: H } = mask;
  const data = mask.getContext("2d")!.getImageData(0, 0, W, H).data;
  const rows: { min: number; max: number; n: number; sum: number }[] = [];
  let top = -1;
  let bottom = -1;
  let left = W;
  let right = -1;
  let area = 0;
  for (let y = 0; y < H; y++) {
    const row = { min: W, max: -1, n: 0, sum: 0 };
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3]! < 128) continue;
      row.n++;
      row.sum += x;
      if (x < row.min) row.min = x;
      if (x > row.max) row.max = x;
    }
    rows.push(row);
    // Linhas com poucos pixels são ruído da máscara.
    if (row.n < W * 0.03) continue;
    if (top < 0) top = y;
    bottom = y;
    left = Math.min(left, row.min);
    right = Math.max(right, row.max);
    area += row.n;
  }
  if (top < 0 || area < W * H * 0.03) return null;
  const h = bottom - top + 1;
  // A cabeça é o primeiro bloco estreito; os ombros são onde a largura salta.
  let headWidth = 0;
  let shoulders = Math.min(bottom, top + Math.round(h * 0.3));
  for (let y = top; y <= bottom; y++) {
    const n = rows[y]!.n;
    if (y - top > H * 0.04 && headWidth > 0 && n > headWidth * 1.6) {
      shoulders = y;
      break;
    }
    headWidth = Math.max(headWidth, n);
    if (y - top > h * 0.45) break;
  }
  let fx = 0;
  let fn = 0;
  for (let y = top; y < shoulders; y++) {
    fx += rows[y]!.sum;
    fn += rows[y]!.n;
  }
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    t: r(t),
    x: r(left / W),
    y: r(top / H),
    w: r((right - left + 1) / W),
    h: r(h / H),
    faceX: r(fn ? fx / fn / W : (left + right) / 2 / W),
    faceY: r((top + (shoulders - top) * 0.55) / H),
  };
}

export type VideoAnalysis = { subject: Subject[]; frames: { t: number; data: string }[] };

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Percorre alguns quadros do vídeo: mede onde o apresentador está (segmentação)
 * e guarda três quadros pequenos em JPEG para o agente ver o enquadramento.
 */
export async function analyzeVideo(file: Blob, assetId: string): Promise<VideoAnalysis> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  const out: VideoAnalysis = { subject: [], frames: [] };
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("vídeo ilegível"));
    });
    const canSegment = await ensureSegmenter();
    const count = Math.min(8, Math.max(3, Math.round(v.duration / 8)));
    const frameAt = new Set([0, Math.floor(count / 2), count - 1]);
    const scale = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * v.duration;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = t;
      });
      if (canSegment) {
        const mask = personMask(`subject:${assetId}:${i}`, v, v.videoWidth, v.videoHeight);
        const subject = mask ? subjectFromMask(mask, t) : null;
        if (subject) out.subject.push(subject);
      }
      if (frameAt.has(i)) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
        if (blob) out.frames.push({ t: Math.round(t * 10) / 10, data: await blobToBase64(blob) });
      }
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src");
    v.load();
  }
}
