import { voiceRanges, type MusicMood, type Project } from "@videoeditor/core";

/**
 * Trilha de fundo da casa e auto-ducking. A trilha é sintetizada em código
 * (determinística, sem arquivos nem licenças): um loop por clima, que o
 * preview e a exportação tocam igual. O ducking é uma função pura do estado.
 */

/** Quanto a trilha desce sob a voz. */
export const DUCK_DB = -14;
export const DUCK_GAIN = Math.pow(10, DUCK_DB / 20);
/** Descida rápida antes da fala, subida lenta depois: o ouvido não percebe a manobra. */
export const DUCK_ATTACK = 0.18;
export const DUCK_RELEASE = 0.45;

export type GainPoint = { t: number; gain: number };

/**
 * Envelope de ganho da trilha: 1 nas pausas, −14 dB enquanto há voz ativa,
 * com rampas suaves. Pontos em ordem de tempo, para automação linear.
 */
export function duckingEnvelope(project: Project): GainPoint[] {
  if (!project.music.duck) return [{ t: 0, gain: 1 }];
  const voice = voiceRanges(project);
  // Pausas curtas demais para a trilha subir e descer de novo ficam abaixadas.
  const merged: { start: number; end: number }[] = [];
  for (const r of voice) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < DUCK_ATTACK + DUCK_RELEASE + 0.25) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  const pts: GainPoint[] = [{ t: 0, gain: merged[0] && merged[0].start <= DUCK_ATTACK ? DUCK_GAIN : 1 }];
  for (const r of merged) {
    const down = Math.max(0, r.start - DUCK_ATTACK);
    if (down > pts[pts.length - 1]!.t) pts.push({ t: down, gain: 1 });
    pts.push({ t: Math.max(r.start, pts[pts.length - 1]!.t), gain: DUCK_GAIN }, { t: r.end, gain: DUCK_GAIN }, { t: r.end + DUCK_RELEASE, gain: 1 });
  }
  return pts;
}

/** Ganho do envelope em `t` (interpolação linear). */
export function gainAt(points: GainPoint[], t: number): number {
  if (!points.length) return 1;
  if (t <= points[0]!.t) return points[0]!.gain;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t <= b.t) return b.t - a.t < 1e-6 ? b.gain : a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1]!.gain;
}

type Mood = Exclude<MusicMood, "none">;
/** Andamento e tamanho do loop de cada clima (4 compassos de 4 tempos). */
export const MUSIC_SPECS: Record<Mood, { bpm: number; bars: number }> = { action: { bpm: 110, bars: 4 }, ambient: { bpm: 60, bars: 4 }, upbeat: { bpm: 120, bars: 4 } };
export const musicLoopSeconds = (mood: Mood) => (60 / MUSIC_SPECS[mood].bpm) * 4 * MUSIC_SPECS[mood].bars;

/** Instantes das batidas (tempos fortes) da trilha na timeline, para sincronizar cortes e impactos. */
export function musicBeats(mood: MusicMood, duration: number): number[] {
  if (mood === "none") return [];
  const beat = 60 / MUSIC_SPECS[mood].bpm;
  return Array.from({ length: Math.floor(duration / beat) + 1 }, (_, i) => Math.round(i * beat * 1000) / 1000);
}

function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

const TAU = Math.PI * 2;
const hz = (semitonesFromA1: number) => 55 * Math.pow(2, semitonesFromA1 / 12);

/**
 * Um loop da trilha, mono, com pico em −12 dBFS e emenda sem estalo (toda
 * fase e todo envelope fecham o ciclo). Determinístico.
 */
export function synthMusic(mood: Mood, sampleRate: number): Float32Array {
  const { bpm, bars } = MUSIC_SPECS[mood];
  const beat = 60 / bpm;
  const total = beat * 4 * bars;
  const n = Math.round(total * sampleRate);
  const out = new Float32Array(n);
  const rnd = noise({ action: 71, ambient: 89, upbeat: 97 }[mood]);
  let lp = 0;
  let hp = 0;
  // Fundamental de cada compasso (em semitons a partir de Lá1): progressão menor para ação, maior para o resto.
  const roots = mood === "action" ? [0, 0, -4, -2] : mood === "ambient" ? [0, -4, 3, -2] : [3, 3, 8, 5];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const bar = Math.min(bars - 1, Math.floor(t / (beat * 4)));
    const inBeat = (t % beat) / beat;
    const beatIndex = Math.floor(t / beat);
    const root = hz(roots[bar]!);
    const white = rnd();
    let v = 0;
    if (mood === "action") {
      // Bumbo em todo tempo (senoide que despenca), sub pulsando em colcheias, drone com batimento e prato de ruído no contratempo.
      const kt = inBeat * beat;
      v += Math.sin(TAU * (48 * kt + (70 / 28) * (1 - Math.exp(-28 * kt)))) * Math.exp(-kt * 9) * 0.9;
      const eighth = ((t % (beat / 2)) / (beat / 2)) as number;
      v += Math.sin(TAU * root * t) * (0.25 + 0.75 * Math.exp(-eighth * 3.2)) * 0.5;
      v += (Math.sin(TAU * root * 2 * t) + Math.sin(TAU * root * 2.996 * t)) * 0.07 * (0.6 + 0.4 * Math.sin((TAU * t) / (beat * 8)));
      hp += 0.55 * (white - hp);
      const off = (inBeat + 0.5) % 1;
      v += (white - hp) * Math.exp(-off * 14) * 0.16;
      // Caixa grave nos tempos 2 e 4.
      if (beatIndex % 2 === 1) {
        lp += 0.22 * (white - lp);
        v += lp * Math.exp(-inBeat * 7) * 0.5;
      }
    } else if (mood === "ambient") {
      // Pad: tríade com sétima em senoides levemente desafinadas, respirando devagar.
      const breathe = 0.6 + 0.4 * Math.sin((TAU * t) / (beat * 4) - Math.PI / 2);
      const bass = root * 2;
      for (const [ratio, gain] of [[1, 0.5], [1.5, 0.3], [2, 0.26], [2.378, 0.2], [3, 0.12]] as const) v += Math.sin(TAU * bass * ratio * t + Math.sin(TAU * 0.25 * t) * 0.4) * gain * breathe * 0.4;
      lp += 0.02 * (white - lp);
      v += lp * 0.12;
    } else {
      // Bumbo suave em todo tempo, baixo na fundamental, arpejo pentatônico em colcheias e chimbal no contratempo.
      const kt = inBeat * beat;
      v += Math.sin(TAU * (52 * kt + (60 / 30) * (1 - Math.exp(-30 * kt)))) * Math.exp(-kt * 11) * 0.7;
      v += Math.sin(TAU * root * t) * (0.4 + 0.6 * Math.exp(-inBeat * 2.5)) * 0.32;
      const step = Math.floor(t / (beat / 2));
      const note = root * 4 * Math.pow(2, [0, 4, 7, 9, 12, 9, 7, 4][step % 8]! / 12);
      const st = (t % (beat / 2)) as number;
      v += (Math.sin(TAU * note * st) + 0.3 * Math.sin(TAU * note * 2 * st)) * Math.exp(-st * 9) * Math.min(1, st / 0.004) * 0.2;
      hp += 0.6 * (white - hp);
      v += (white - hp) * Math.exp(-((inBeat + 0.5) % 1) * 18) * 0.1;
    }
    out[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const gain = peak > 0 ? Math.pow(10, -12 / 20) / peak : 0;
  // Emenda do loop: 12 ms de fade nas duas pontas.
  const edge = Math.min(n >> 1, Math.round(0.012 * sampleRate));
  for (let i = 0; i < n; i++) out[i] = out[i]! * gain * Math.min(1, i / edge, (n - 1 - i) / edge);
  return out;
}
