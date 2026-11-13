import type { AssetAnalysis, Genre, Project, TimeRange } from "./schema";
import { clipEnd, localTimeAt, mainClips, normalizeRanges, r3, sourceRangesToTimeline, sourceSpan, timelineWords } from "./timeline";

/**
 * Análise multimodal além da fala. O navegador mede os números brutos
 * (diferença entre quadros, nível do áudio); aqui ficam as decisões, puras e
 * testáveis: gênero editorial, mudanças de plano, picos de energia e os
 * trechos de ação que nenhuma remoção de silêncio pode cortar.
 */

export type MotionSample = { t: number; v: number };

/** Normaliza o movimento bruto pelo percentil 95 do próprio vídeo (0–1). */
export function normalizeMotion(raw: MotionSample[]): { motion: MotionSample[]; level: number } {
  if (!raw.length) return { motion: [], level: 0 };
  const sorted = raw.map((s) => s.v).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] || 0;
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const k = p95 > 1e-6 ? 1 / p95 : 0;
  return { motion: raw.map((s) => ({ t: r3(s.t), v: r3(Math.min(1, s.v * k)) })), level: r3(mean) };
}

/**
 * Mudanças de plano: saltos na diferença entre quadros muito acima da
 * vizinhança (um corte muda o quadro inteiro; movimento muda parte dele).
 */
export function detectCuts(raw: MotionSample[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < raw.length - 1; i++) {
    const around = [raw[i - 2], raw[i - 1], raw[i + 1], raw[i + 2]].filter((s): s is MotionSample => !!s).map((s) => s.v);
    const base = around.reduce((s, v) => s + v, 0) / around.length;
    const v = raw[i]!.v;
    if (v > 0.22 && v > base * 3 + 0.05 && (!out.length || raw[i]!.t - out[out.length - 1]! > 0.4)) out.push(r3(raw[i]!.t));
  }
  return out;
}

/**
 * Picos de energia: máximos locais de movimento e transientes de áudio
 * (subidas bruscas de decibéis). Quando os dois coincidem, o pico é "both" —
 * é ali que um impacto, um corte na batida ou um efeito sonoro rende mais.
 */
export function energyPeaks(motion: MotionSample[], audio: { t: number; db: number }[], max = 24): AssetAnalysis["peaks"] {
  const peaks: AssetAnalysis["peaks"] = [];
  for (let i = 1; i < motion.length - 1; i++) {
    const v = motion[i]!.v;
    if (v >= 0.55 && v >= motion[i - 1]!.v && v > motion[i + 1]!.v) peaks.push({ t: motion[i]!.t, kind: "visual", strength: r3(v) });
  }
  for (let i = 2; i < audio.length; i++) {
    // Transiente: sobe pelo menos 9 dB em relação à média das duas janelas anteriores.
    const rise = audio[i]!.db - (audio[i - 1]!.db + audio[i - 2]!.db) / 2;
    if (rise >= 9 && audio[i]!.db > -45) peaks.push({ t: audio[i]!.t, kind: "audio", strength: r3(Math.min(1, rise / 24)) });
  }
  peaks.sort((a, b) => a.t - b.t);
  const merged: AssetAnalysis["peaks"] = [];
  for (const p of peaks) {
    const last = merged[merged.length - 1];
    if (last && p.t - last.t < 0.4) {
      if (last.kind !== p.kind) {
        last.kind = "both";
        last.strength = r3(Math.min(1, Math.max(last.strength, p.strength) + 0.2));
      } else if (p.strength > last.strength) Object.assign(last, p);
    } else merged.push({ ...p });
  }
  return merged.sort((a, b) => b.strength - a.strength).slice(0, max);
}

/** Trechos de alta atividade visual (movimento normalizado ≥ limiar), com pontes de até 1 s. */
export function actionRanges(motion: MotionSample[], threshold = 0.45): TimeRange[] {
  const out: TimeRange[] = [];
  const step = motion.length > 1 ? (motion[motion.length - 1]!.t - motion[0]!.t) / (motion.length - 1) : 0.5;
  for (const s of motion) {
    if (s.v < threshold) continue;
    const last = out[out.length - 1];
    if (last && s.t - last.end <= 1) last.end = r3(s.t + step / 2);
    else out.push({ start: r3(Math.max(0, s.t - step / 2)), end: r3(s.t + step / 2) });
  }
  return out;
}

export type GenreSignals = {
  duration: number;
  /** Fração do vídeo com voz ativa (VAD). */
  speechRatio: number;
  /** Palavras da transcrição, quando existe. */
  wordCount?: number;
  /** Movimento médio absoluto (0–1). */
  motionLevel: number;
  /** Mudanças de plano por minuto. */
  cutsPerMin: number;
  /** A segmentação achou uma pessoa na maior parte dos quadros. */
  hasPerson: boolean;
};

/**
 * Classificador de gênero, determinístico. Fala contínua é talking-head;
 * pouca fala com movimento é ação; tela quase parada sem ninguém em quadro é
 * demonstração; muitos planos e movimento com fala intermitente é montagem.
 */
export function classifyGenre(s: GenreSignals): { genre: Genre; reason: string } {
  const minutes = Math.max(s.duration / 60, 1 / 60);
  const wpm = s.wordCount !== undefined ? s.wordCount / minutes : null;
  const pct = `${Math.round(s.speechRatio * 100)}%`;
  const sparseSpeech = wpm !== null ? wpm < 45 : s.speechRatio < 0.22;
  if (sparseSpeech) {
    const said = wpm !== null ? `${s.wordCount} palavras em ${Math.round(s.duration)}s` : `voz em ${pct} do tempo`;
    if (s.motionLevel >= 0.03 || s.cutsPerMin >= 4 || s.hasPerson) return { genre: "action_cinematic", reason: `Quase sem fala (${said}) e a cena é visual: a edição segue a ação, não as palavras.` };
    return { genre: "tutorial_demo", reason: `Quase sem fala (${said}) e imagem quase parada, sem ninguém em quadro: parece demonstração de tela.` };
  }
  if (!s.hasPerson && s.motionLevel < 0.025) return { genre: "tutorial_demo", reason: `Fala contínua (${pct}) sobre uma imagem quase estática sem apresentador: gravação de tela ou demonstração.` };
  if (s.cutsPerMin >= 8 || (s.motionLevel >= 0.08 && s.speechRatio < 0.6)) return { genre: "vlog_montage", reason: `${Math.round(s.cutsPerMin)} mudanças de plano por minuto e muito movimento, com fala intermitente: montagem dinâmica.` };
  return { genre: "talking_head", reason: `Fala contínua para a câmera (voz em ${pct} do tempo) com enquadramento estável.` };
}

/** Trechos com voz ativa em tempo de TIMELINE: pela transcrição ou, sem ela, pelo VAD do áudio. */
export function voiceRanges(project: Project): TimeRange[] {
  const words = timelineWords(project);
  if (words.length) {
    const out: TimeRange[] = [];
    for (const w of words) {
      const last = out[out.length - 1];
      // Pausas curtas entre palavras são a mesma fala: a trilha não sobe e desce a cada sílaba.
      if (last && w.start - last.end < 0.45) last.end = Math.max(last.end, w.end);
      else out.push({ start: w.start, end: w.end });
    }
    return out;
  }
  const out: TimeRange[] = [];
  for (const asset of Object.values(project.assets)) {
    if (!asset.analysis?.speech.length || asset.role === "context") continue;
    out.push(...sourceRangesToTimeline(project, asset.id, asset.analysis.speech));
  }
  return normalizeRanges(out);
}

/** Trechos de ação em tempo de TIMELINE (para proteger de cortes e orientar o agente). */
export function timelineActionRanges(project: Project, threshold = 0.45): TimeRange[] {
  const out: TimeRange[] = [];
  for (const asset of Object.values(project.assets)) {
    if (!asset.analysis?.motion.length || asset.role === "context") continue;
    out.push(...sourceRangesToTimeline(project, asset.id, actionRanges(asset.analysis.motion, threshold)));
  }
  return normalizeRanges(out);
}

export type TimelinePeak = { t: number; source: number; assetId: string; kind: "visual" | "audio" | "both"; strength: number };

/** Picos de energia que ainda estão na timeline, em tempo de timeline, do mais forte ao mais fraco. */
export function timelinePeaks(project: Project): TimelinePeak[] {
  const out: TimelinePeak[] = [];
  for (const clip of mainClips(project)) {
    const peaks = project.assets[clip.assetId]?.analysis?.peaks;
    if (!peaks) continue;
    const end = clip.sourceStart + sourceSpan(clip);
    for (const p of peaks) if (p.t >= clip.sourceStart && p.t < end) out.push({ t: r3(clip.start + localTimeAt(clip, p.t)), source: p.t, assetId: clip.assetId, kind: p.kind, strength: p.strength });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

/** Pontos de corte da trilha principal (emendas entre clips e bordas de lacunas). */
export function cutPoints(project: Project): number[] {
  const set = new Set<number>();
  for (const c of mainClips(project)) {
    if (c.start > 0.001) set.add(c.start);
    set.add(clipEnd(c));
  }
  return [...set].sort((a, b) => a - b);
}
