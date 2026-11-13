"use client";

import { classifyGenre, detectCuts, energyPeaks, normalizeMotion, speechProfile, type Asset, type AssetAnalysis, type MotionSample, type Word } from "@videoeditor/core";
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
    // Tamanho do rosto: é o que diz se o plano é close-up (texto atrás da cabeça fica ilegível).
    faceW: r(Math.max(headWidth, 1) / W),
    faceH: r((shoulders - top) / H),
  };
}

export type VideoAnalysis = { subject: Subject[]; frames: { t: number; data: string }[]; analysis: AssetAnalysis | null };

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Quadro reduzido a tons de cinza 48×27: o bastante para medir movimento, barato o bastante para centenas de quadros. */
const MOTION_W = 48;
const MOTION_H = 27;

/**
 * Energia acústica: o perfil de fala do arquivo (VAD adaptativo) e o nível
 * por janela de 100 ms, de onde saem os transientes (picos de decibéis).
 */
export function audioEnergy(samples: Float32Array, sampleRate: number) {
  const profile = speechProfile(samples, sampleRate);
  const per = Math.max(1, Math.round(0.1 / profile.windowSec));
  const env: { t: number; db: number }[] = [];
  for (let i = 0; i < profile.levels.length; i += per) {
    let max = -100;
    for (let j = i; j < Math.min(i + per, profile.levels.length); j++) max = Math.max(max, profile.levels[j]!);
    env.push({ t: Math.round(i * profile.windowSec * 100) / 100, db: max });
  }
  const total = samples.length / sampleRate;
  const spoken = profile.speech.reduce((s, r) => s + r.end - r.start, 0);
  return { profile, env, speechRatio: total > 0 ? Math.min(1, spoken / total) : 0 };
}

/**
 * Análise multimodal do vídeo, além da fala. Percorre o vídeo medindo:
 * - movimento entre quadros (fluxo óptico aproximado pela diferença de luminância) e mudanças de plano;
 * - onde o sujeito está e o tamanho do rosto (segmentação, em alguns quadros);
 * - com o áudio (`samples`), a voz ativa e os transientes.
 * Daí saem os picos de energia e o gênero editorial. Também guarda três
 * quadros pequenos em JPEG para o agente ver o enquadramento.
 */
export async function analyzeVideo(file: Blob, assetId: string, samples?: Float32Array | null, sampleRate = 16000, wordCount?: number, opts: { maxSamples?: number; perSecond?: number; segment?: boolean; until?: number } = {}): Promise<VideoAnalysis> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = url;
  const out: VideoAnalysis = { subject: [], frames: [], analysis: null };
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("vídeo ilegível"));
    });
    const canSegment = opts.segment === false ? false : await ensureSegmenter();
    // Com `until`, só o começo do vídeo é medido (referência longa).
    const duration = Math.min(v.duration, opts.until ?? Infinity);
    // ~3 amostras por segundo, limitado para vídeos longos não travarem a análise.
    const count = Math.min(opts.maxSamples ?? 200, Math.max(12, Math.round(duration * (opts.perSecond ?? 3))));
    const segEvery = Math.max(1, Math.round(count / Math.min(10, Math.max(3, Math.round(duration / 6)))));
    const frameAt = new Set([0, Math.floor(count / 2), count - 1].map((i) => Math.min(count - 1, Math.round(i / segEvery) * segEvery)));
    const scale = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    const small = document.createElement("canvas");
    small.width = MOTION_W;
    small.height = MOTION_H;
    const sctx = small.getContext("2d", { willReadFrequently: true })!;
    let prev: Uint8ClampedArray | null = null;
    const raw: MotionSample[] = [];
    let segmented = 0;
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * duration;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = t;
      });
      sctx.drawImage(v, 0, 0, MOTION_W, MOTION_H);
      const px = sctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
      const gray = new Uint8ClampedArray(MOTION_W * MOTION_H);
      for (let k = 0; k < gray.length; k++) gray[k] = (px[k * 4]! * 77 + px[k * 4 + 1]! * 150 + px[k * 4 + 2]! * 29) >> 8;
      if (prev) {
        let sum = 0;
        for (let k = 0; k < gray.length; k++) sum += Math.abs(gray[k]! - prev[k]!);
        raw.push({ t, v: sum / gray.length / 255 });
      }
      prev = gray;
      if (i % segEvery === 0) {
        segmented++;
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
    }
    const { motion, level } = normalizeMotion(raw);
    const cuts = detectCuts(raw);
    const audio = samples ? audioEnergy(samples, sampleRate) : null;
    const genre = classifyGenre({
      duration,
      speechRatio: audio?.speechRatio ?? 0.5,
      wordCount,
      motionLevel: level,
      cutsPerMin: cuts.length / Math.max(duration / 60, 1 / 60),
      hasPerson: canSegment ? out.subject.length >= segmented / 2 : true,
    });
    out.analysis = {
      genre: genre.genre,
      reason: genre.reason,
      motion,
      cuts,
      peaks: energyPeaks(motion, audio?.env ?? []),
      speech: audio?.profile.speech ?? [],
      noiseFloorDb: audio ? Math.round(audio.profile.noiseFloorDb * 10) / 10 : undefined,
      speechDb: audio ? Math.round(audio.profile.speechDb * 10) / 10 : undefined,
      speechRatio: Math.round((audio?.speechRatio ?? 0) * 1000) / 1000,
      motionLevel: level,
    };
    return out;
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute("src");
    v.load();
  }
}
