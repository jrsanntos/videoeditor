import type { Word } from "./schema";
import { speechProfile } from "./silence";
import { r3 } from "./timeline";

/**
 * Fronteiras de palavra conferidas no áudio.
 *
 * Os cortes por palavra (erros de gravação, muletas, cut_words) caem no início
 * da palavra seguinte, e esse instante vem do transcritor, que erra na casa de
 * um décimo de segundo: o corte come a consoante de ataque ou deixa um resto da
 * palavra cortada. Aqui cada fronteira é levada ao ponto que o áudio mostra:
 *
 * - com pausa antes da palavra: o início recua até onde a voz realmente começa
 *   (mais uma margem curta), sem invadir a palavra anterior;
 * - palavras coladas: a fronteira vai para o vale de energia mais próximo, se
 *   houver um vale claro; fala contínua, sem vale, fica como veio.
 *
 * Conservador: áudio sem contraste (música alta, ruído) devolve as palavras
 * intactas, e nenhuma palavra encolhe abaixo de `minWord`.
 */
export const ONSET_RULES = {
  /** Janela de análise (s). */
  frame: 0.01,
  /** Até onde a fronteira pode andar para cada lado (s). */
  reach: 0.12,
  /** Margem mantida antes de a voz começar (s). */
  pad: 0.02,
  /** Queda mínima (dB) em relação ao pico vizinho para um vale valer como fronteira. */
  dip: 8,
  /** Palavras a menos disto uma da outra (s) são tratadas como coladas. */
  joined: 0.05,
  /** Nenhuma palavra fica menor que isto (s). */
  minWord: 0.06,
} as const;

export function snapWordOnsets(words: Word[], samples: Float32Array, sampleRate: number): Word[] {
  if (words.length < 2 || !samples.length) return words;
  const R = ONSET_RULES;
  const profile = speechProfile(samples, sampleRate, { windowMs: R.frame * 1000 });
  if (!profile.reliable) return words;
  const { levels, thresholdDb } = profile;
  const frames = levels.length;
  const at = (t: number) => Math.min(frames - 1, Math.max(0, Math.floor(t / R.frame)));
  const out = words.map((w) => ({ ...w }));

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const w = out[i]!;
    // Marcas de hesitação já foram medidas no áudio: as fronteiras delas não mudam.
    if (prev.disfluency || w.disfluency) continue;
    if (!(w.end > w.start) || !(prev.end > prev.start) || w.start < prev.end - 0.001) continue;
    const latest = Math.min(w.start + R.reach, w.end - R.minWord);

    if (w.start - prev.end >= R.joined) {
      // Há uma pausa: o início recua enquanto houver voz antes dele, até o fim da palavra anterior.
      const floor = Math.max(prev.end, w.start - R.reach);
      let k = at(w.start);
      if (levels[k]! < thresholdDb) continue; // o transcritor já marcou o início em silêncio: sobra folga, nada a fazer
      while (k > at(floor) && levels[k - 1]! >= thresholdDb) k--;
      const onset = Math.max(floor, k * R.frame - R.pad);
      if (onset < w.start - 0.005) w.start = r3(onset);
      continue;
    }

    // Coladas: procura o vale de energia perto da fronteira.
    const boundary = (prev.end + w.start) / 2;
    const from = at(Math.max(boundary - R.reach, prev.start + R.minWord));
    const to = at(Math.max(boundary, latest));
    if (to - from < 2) continue;
    let low = from;
    let peak = -Infinity;
    for (let k = from; k <= to; k++) {
      const v = levels[k]!;
      if (v > peak) peak = v;
      // Entre vales iguais, fica o mais próximo da fronteira original.
      if (v < levels[low]! - 0.5 || (Math.abs(v - levels[low]!) <= 0.5 && Math.abs(k * R.frame - boundary) < Math.abs(low * R.frame - boundary))) low = k;
    }
    if (peak - levels[low]! < R.dip) continue;
    // O corte cai no fim do vale: a palavra seguinte começa inteira.
    let edge = low;
    while (edge < to && levels[edge + 1]! <= levels[low]! + 3) edge++;
    const snapped = r3(Math.min(Math.max((edge + 1) * R.frame - R.pad / 2, prev.start + R.minWord), w.end - R.minWord));
    if (Math.abs(snapped - boundary) < 0.015) continue;
    prev.end = snapped;
    w.start = snapped;
  }
  return out;
}
