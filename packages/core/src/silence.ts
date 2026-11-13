import type { TimeRange } from "./schema";
import { normalizeRanges, r3 } from "./timeline";

/**
 * Remoção de silêncios com critério de editor: o limiar se calibra pelo
 * próprio arquivo e quatro regras de proteção valem sempre, em qualquer modo.
 */
export const SILENCE_RULES = {
  /** Pausa menor que isto é respiração natural: nunca é cortada. */
  minPause: 0.45,
  /** Margem mantida ANTES de a palavra começar (não decepa a consoante de ataque). */
  preRoll: 0.15,
  /** Margem mantida DEPOIS de a palavra terminar (não decepa a sílaba final). */
  postRoll: 0.22,
  /** Corte menor que isto é descartado, e nenhum trecho mantido entre dois cortes fica menor (sem "metralhadora"). */
  minIsland: 0.3,
} as const;

export type SilenceMode = "aggressive" | "natural" | "dead";
export const SILENCE_MODES: Record<SilenceMode, { name: string; hint: string; minSilence: number }> = {
  aggressive: { name: "Corte Agressivo (Talking-Head)", hint: "Tira toda pausa acima de 0,45 s. Para fala direta à câmera.", minSilence: 0.45 },
  natural: { name: "Ritmo Natural", hint: "Mantém as pausas de raciocínio; corta só acima de 0,8 s.", minSilence: 0.8 },
  dead: { name: "Apenas Pausas Mortas (>1.5s)", hint: "Só o tempo morto. O ritmo original fica intacto.", minSilence: 1.5 },
};

export type SilenceOptions = {
  mode?: SilenceMode;
  /** Pausa mínima (s) para ser cortável. Nunca abaixo de 0,45 s. */
  minSilence?: number;
  /** Legado: respiro simétrico. Vale como piso extra para preRoll/postRoll. */
  padding?: number;
  preRoll?: number;
  postRoll?: number;
  /** Trechos que não podem ser cortados (cenas de ação, alta atividade visual). Mesma base de tempo da entrada. */
  protect?: TimeRange[];
};

function resolve(opts: SilenceOptions) {
  return {
    minSilence: Math.max(SILENCE_RULES.minPause, opts.minSilence ?? SILENCE_MODES[opts.mode ?? "aggressive"].minSilence),
    preRoll: Math.max(SILENCE_RULES.preRoll, opts.preRoll ?? opts.padding ?? 0),
    postRoll: Math.max(SILENCE_RULES.postRoll, opts.postRoll ?? opts.padding ?? 0),
  };
}

/** Tira de `ranges` tudo que cai dentro de `holes`. */
export function subtractRanges(ranges: TimeRange[], holes: TimeRange[]): TimeRange[] {
  let out = ranges.map((r) => ({ ...r }));
  for (const h of holes) {
    const next: TimeRange[] = [];
    for (const r of out) {
      if (h.end <= r.start || h.start >= r.end) next.push(r);
      else {
        if (h.start > r.start) next.push({ start: r.start, end: h.start });
        if (h.end < r.end) next.push({ start: h.end, end: r.end });
      }
    }
    out = next;
  }
  return out;
}

/**
 * Regras finais, comuns às duas detecções: respeita os trechos protegidos,
 * garante que nenhum pedaço mantido entre dois cortes fique menor que
 * `minIsland` (encolhendo os cortes vizinhos) e descarta micro-cortes.
 */
function finish(cuts: TimeRange[], total: number, protect: TimeRange[] | undefined): TimeRange[] {
  let out = normalizeRanges(protect?.length ? subtractRanges(cuts, normalizeRanges(protect)) : cuts, total);
  const min = SILENCE_RULES.minIsland;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const island = b.start - a.end;
    if (island < min) {
      const grow = (min - island) / 2;
      a.end = r3(a.end - grow);
      b.start = r3(b.start + grow);
    }
  }
  out = out.filter((r) => r.end - r.start >= min - 1e-6);
  return out.map((r) => ({ start: r3(r.start), end: r3(r.end) }));
}

/** Silêncios a partir dos intervalos entre palavras (mesma base de tempo das palavras). */
export function silencesFromWords(
  words: { start: number; end: number }[],
  totalDuration: number,
  opts: SilenceOptions = {},
): TimeRange[] {
  const { minSilence, preRoll, postRoll } = resolve(opts);
  const out: TimeRange[] = [];
  let cursor = 0;
  const push = (gapStart: number, gapEnd: number, afterWord: boolean, beforeWord: boolean) => {
    if (gapEnd - gapStart < minSilence) return;
    const start = gapStart + (afterWord ? postRoll : 0);
    const end = gapEnd - (beforeWord ? preRoll : 0);
    if (end > start) out.push({ start, end });
  };
  for (const w of words) {
    push(cursor, w.start, cursor > 0, true);
    cursor = Math.max(cursor, w.end);
  }
  push(cursor, totalDuration, cursor > 0, false);
  return finish(out, totalDuration, opts.protect);
}

export type SpeechProfile = {
  /** Piso de ruído do arquivo: percentil 15 do nível por janela, em dBFS. */
  noiseFloorDb: number;
  /** Voz ativa: percentil 85, em dBFS. */
  speechDb: number;
  /** Limiar dinâmico entre os dois. */
  thresholdDb: number;
  /** false: o áudio não tem contraste suficiente para separar voz de silêncio (não corte nada). */
  reliable: boolean;
  windowSec: number;
  /** Nível RMS de cada janela, em dBFS. */
  levels: Float32Array;
  /** Trechos com voz ativa. */
  speech: TimeRange[];
};

const DB_FLOOR = -100;
const percentile = (sorted: Float32Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] ?? DB_FLOOR;

/**
 * VAD adaptativo: em vez de um limiar fixo de amplitude, mede o perfil
 * acústico do próprio arquivo — piso de ruído (P15) e voz ativa (P85), em
 * dBFS/RMS — e põe o limiar entre os dois. Um vídeo gravado baixo, ou com ar
 * condicionado ao fundo, é tratado pelo que ele é.
 */
export function speechProfile(samples: Float32Array, sampleRate: number, opts: { windowMs?: number; thresholdDb?: number } = {}): SpeechProfile {
  const windowSec = (opts.windowMs ?? 20) / 1000;
  const win = Math.max(1, Math.round(windowSec * sampleRate));
  const n = Math.ceil(samples.length / win);
  const levels = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = k * win;
    const b = Math.min(a + win, samples.length);
    let sum = 0;
    for (let j = a; j < b; j++) sum += samples[j]! * samples[j]!;
    const rms = Math.sqrt(sum / Math.max(1, b - a));
    levels[k] = rms > 1e-5 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR;
  }
  const sorted = Float32Array.from(levels).sort();
  let noiseFloorDb = percentile(sorted, 0.15);
  const speechDb = percentile(sorted, 0.85);
  // Fala muito densa: menos de 15% do arquivo é pausa. O piso desce para o P5.
  if (speechDb - noiseFloorDb < 6) noiseFloorDb = percentile(sorted, 0.05);
  const range = speechDb - noiseFloorDb;
  const reliable = range >= 6 && speechDb > -70;
  // 40% do caminho entre o ruído e a voz, sem nunca ficar a menos de 4 dB do piso nem a menos de 6 dB da voz.
  const thresholdDb = opts.thresholdDb ?? Math.min(speechDb - 6, Math.max(noiseFloorDb + 4, noiseFloorDb + range * 0.4));

  // Janelas com voz → trechos; estalos isolados (< 40 ms) dentro de um silêncio não contam como fala.
  const speech: TimeRange[] = [];
  let from = -1;
  for (let k = 0; k <= n; k++) {
    const voiced = k < n && reliable && levels[k]! >= thresholdDb;
    if (voiced && from < 0) from = k;
    else if (!voiced && from >= 0) {
      if ((k - from) * windowSec >= 0.04) speech.push({ start: r3(from * windowSec), end: r3(Math.min(samples.length / sampleRate, k * windowSec)) });
      from = -1;
    }
  }
  return { noiseFloorDb, speechDb, thresholdDb, reliable, windowSec, levels, speech };
}

export type AudioSilenceOptions = SilenceOptions & {
  /** Força um limiar fixo (dBFS). Sem ele, o limiar é calibrado pelo arquivo. */
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
  const total = samples.length / sampleRate;
  const profile = speechProfile(samples, sampleRate, opts);
  if (!profile.reliable && opts.thresholdDb === undefined) return [];
  // A fala detectada faz o papel das palavras: as mesmas margens e regras valem.
  return silencesFromWords(profile.speech, total, opts);
}

/** Micro-fade (s) aplicado em toda fronteira de corte, na entrada e na saída: elimina cliques e pops. */
export const CUT_FADE = 0.03;

/**
 * Ganho (0–1) do micro-fade num clip: sobe nos primeiros 30 ms e desce nos
 * últimos 30 ms. Clips muito curtos usam um quarto da duração de cada lado.
 */
export function cutFadeGain(local: number, duration: number): number {
  const edge = Math.min(CUT_FADE, duration / 4);
  if (edge <= 0) return 1;
  return Math.max(0, Math.min(1, local / edge, (duration - local) / edge));
}
