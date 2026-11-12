import type { TimeRange } from "./schema";
import { normalizeRanges } from "./timeline";

export type SilenceOptions = {
  /** Pausa mínima (s) para ser considerada silêncio cortável. */
  minSilence?: number;
  /** Respiro (s) preservado antes/depois da fala. */
  padding?: number;
};

/** Silêncios a partir dos intervalos entre palavras (mesma base de tempo das palavras). */
export function silencesFromWords(
  words: { start: number; end: number }[],
  totalDuration: number,
  opts: SilenceOptions = {},
): TimeRange[] {
  const minSilence = opts.minSilence ?? 0.5;
  const padding = opts.padding ?? 0.1;
  const out: TimeRange[] = [];
  let cursor = 0;
  const push = (gapStart: number, gapEnd: number, padStart: boolean, padEnd: boolean) => {
    if (gapEnd - gapStart < minSilence) return;
    out.push({
      start: gapStart + (padStart ? padding : 0),
      end: gapEnd - (padEnd ? padding : 0),
    });
  };
  for (const w of words) {
    push(cursor, w.start, cursor > 0, true);
    cursor = Math.max(cursor, w.end);
  }
  push(cursor, totalDuration, true, false);
  return normalizeRanges(out, totalDuration);
}

export type AudioSilenceOptions = SilenceOptions & {
  /** Abaixo deste nível (dBFS, RMS por janela) é silêncio. */
  thresholdDb?: number;
  windowMs?: number;
};

/**
 * Silêncios a partir das amostras de áudio (mono). Roda no navegador do
 * usuário, sem transcrição e sem custo de nuvem.
 */
export function silencesFromAudio(
  samples: Float32Array,
  sampleRate: number,
  opts: AudioSilenceOptions = {},
): TimeRange[] {
  const minSilence = opts.minSilence ?? 0.5;
  const padding = opts.padding ?? 0.1;
  const threshold = Math.pow(10, (opts.thresholdDb ?? -38) / 20);
  const win = Math.max(1, Math.round(((opts.windowMs ?? 20) / 1000) * sampleRate));
  const total = samples.length / sampleRate;
  const out: TimeRange[] = [];
  let silentFrom: number | null = null;

  const close = (endSec: number) => {
    if (silentFrom === null) return;
    const from = silentFrom;
    silentFrom = null;
    if (endSec - from < minSilence) return;
    out.push({
      start: from <= 0 ? 0 : from + padding,
      end: endSec >= total ? total : endSec - padding,
    });
  };

  for (let i = 0; i < samples.length; i += win) {
    const end = Math.min(i + win, samples.length);
    let sum = 0;
    for (let j = i; j < end; j++) sum += samples[j]! * samples[j]!;
    const rms = Math.sqrt(sum / (end - i));
    const t = i / sampleRate;
    if (rms < threshold) {
      if (silentFrom === null) silentFrom = t;
    } else {
      close(t);
    }
  }
  close(total);
  return normalizeRanges(out, total);
}
