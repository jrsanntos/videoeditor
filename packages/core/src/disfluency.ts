import { HESITATION } from "./fillers";
import type { Word } from "./schema";

/**
 * Hesitações que a transcrição esconde. O Whisper não escreve "hum", "é…" nem
 * a tentativa antes de repetir uma palavra: ele estica a duração da palavra
 * vizinha (no vídeo de teste, "incapacitação" durou 2,2 s e "estão", 2,7 s).
 * Aqui: achar essas palavras esticadas, separar o que é hesitação (segunda
 * escuta do trecho) ou tentativa abandonada (pausa no meio da palavra, medida
 * no áudio) e devolver a transcrição com isso marcado, para a limpeza cortar.
 * Tudo puro: o navegador mede o áudio e chama o servidor; aqui só decisões.
 */

const VOWELS = /[aeiouáéíóúâêôãõàüy]+/gi;
const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Sílabas aproximadas (grupos de vogais): basta para o ritmo da fala. */
export const syllables = (text: string) => Math.max(1, (bare(text).match(VOWELS) ?? []).length);

/** Segundos por sílaba do apresentador (mediana, sem as palavras esticadas). */
export function speechRate(words: Word[]): number {
  const rates = words
    .filter((w) => !w.disfluency && syllables(w.text) >= 2 && w.end > w.start)
    .map((w) => (w.end - w.start) / syllables(w.text))
    .sort((a, b) => a - b);
  if (rates.length < 5) return 0.2;
  // Descarta o quartil de cima (é onde estão as palavras esticadas).
  const kept = rates.slice(0, Math.max(3, Math.floor(rates.length * 0.75)));
  return Math.min(0.35, Math.max(0.1, kept[Math.floor(kept.length / 2)]!));
}

/** Duração esperada da palavra no ritmo da pessoa. */
export const expectedDuration = (w: Word, rate: number) => syllables(w.text) * rate;

/** Palavras que duraram muito mais do que o ritmo da pessoa explica: escondem algo. */
export function stretchedWords(words: Word[], rate = speechRate(words)): Word[] {
  return words.filter((w) => !w.disfluency && w.end - w.start > expectedDuration(w, rate) * 1.6 + 0.35);
}

/**
 * Envelope de energia (dB, quadros de `frame` s) de `samples` entre `start` e
 * `end`, em segundos do áudio.
 */
export function energyEnvelope(samples: Float32Array, sampleRate: number, start: number, end: number, frame = 0.02): number[] {
  const n = Math.max(1, Math.round(frame * sampleRate));
  const out: number[] = [];
  for (let i = Math.max(0, Math.floor(start * sampleRate)); i + n <= Math.min(samples.length, Math.ceil(end * sampleRate)); i += n) {
    let sum = 0;
    for (let k = i; k < i + n; k++) sum += samples[k]! * samples[k]!;
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

/**
 * Tentativa abandonada dentro de uma palavra esticada: voz, pausa de pelo
 * menos `minPause` s, e depois a palavra inteira de novo. Uma palavra falada
 * de uma vez não tem silêncio no meio. Devolve o trecho a cortar (do começo da
 * palavra ao fim da pausa), em segundos, ou null.
 */
export function falseStart(w: Word, envelope: number[], rate: number, frame = 0.02, minPause = 0.14): { start: number; end: number } | null {
  // Só palavras longas: numa palavra curta ("em", "do") a pausa é o respiro antes da próxima,
  // e repetições curtas ("o o") o transcritor já escreve separadas.
  if (syllables(w.text) < 3 || envelope.length < 10) return null;
  if (!stretchedWords([w], rate).length) return null;
  const peak = Math.max(...envelope);
  const floor = [...envelope].sort((a, b) => a - b)[Math.floor(envelope.length * 0.1)]!;
  const quiet = Math.max(floor + 6, peak - 28);
  const need = Math.ceil(minPause / frame);
  let lastPauseEnd = -1;
  let run = 0;
  // Ignora as bordas: o silêncio antes ou depois da palavra não é pausa interna.
  const edge = Math.ceil(0.1 / frame);
  for (let i = edge; i < envelope.length - edge; i++) {
    if (envelope[i]! < quiet) run++;
    else {
      if (run >= need) lastPauseEnd = i;
      run = 0;
    }
  }
  if (lastPauseEnd < 0) return null;
  const cutEnd = w.start + lastPauseEnd * frame;
  const expected = expectedDuration(w, rate);
  // Na dúvida, não corta. Só é tentativa abandonada quando o formato bate:
  // - antes da pausa, um pedaço CURTO com voz (a tentativa, não uma palavra inteira);
  // - depois da pausa, a palavra inteira (nem um fragmento, nem duas palavras).
  // Uma palavra seguida de um respiro natural não tem esse formato e fica.
  const firstVoice = envelope.findIndex((v) => v >= quiet);
  const pauseStart = lastPauseEnd - run0(envelope, lastPauseEnd, quiet);
  const attempt = (pauseStart - Math.max(0, firstVoice)) * frame;
  const rest = w.end - cutEnd;
  // A tentativa tem ao menos uma ou duas sílabas de verdade (0,25 s): um fragmento menor é o
  // fim da palavra anterior mal alinhado pelo transcritor, seguido do respiro.
  if (attempt < Math.max(0.25, expected * 0.35) || attempt > expected * 1.1) return null;
  if (rest < expected * 0.6 || rest > expected * 1.8 + 0.3) return null;
  return { start: w.start, end: Math.max(w.start, cutEnd - 0.04) };
}

/** Quantos quadros silenciosos vêm imediatamente antes de `end`. */
function run0(envelope: number[], end: number, quiet: number): number {
  let n = 0;
  for (let i = end - 1; i >= 0 && envelope[i]! < quiet; i--) n++;
  return n;
}

/** Som de hesitação devolvido pela segunda escuta ("hum", "é…", "eeh"). */
export const isHesitationToken = (text: string, duration = 0) => {
  const b = bare(text);
  if (HESITATION.test(b) || ["eh", "ahn", "hã", "eeh", "ééé"].includes(b) || /^(é|e){2,}h*$/.test(b)) return true;
  // "e" e "é" curtos são conjunção e verbo: só o som ALONGADO é hesitação.
  return (b === "é" || b === "e" || b === "ah") && duration >= 0.4;
};

/**
 * Junta o que a segunda escuta achou dentro do trecho de `w` (palavras com
 * tempos relativos ao trecho que começou em `spanStart`): cada hesitação vira
 * uma "palavra" marcada, e a palavra original encolhe para não cobri-la.
 */
export function splitHesitations(w: Word, spanWords: { text: string; start: number; end: number }[], spanStart: number): Word[] {
  const hits = spanWords
    // O som reouvido não pode ser a própria palavra (o "e" de "e não deve" é a conjunção).
    .filter((s) => isHesitationToken(s.text, s.end - s.start) && bare(s.text) !== bare(w.text))
    .map((s) => ({ len: s.end - s.start, start: Math.max(w.start, spanStart + s.start), end: Math.min(w.end, spanStart + s.end) }))
    // Precisa cair DENTRO da palavra esticada (a maior parte), não na vizinha.
    .filter((h) => h.end - h.start >= 0.2 && h.end - h.start >= h.len * 0.7);
  if (!hits.length) return [w];
  const out: Word[] = [];
  let word = { ...w };
  hits.forEach((h, i) => {
    const mark: Word = { id: `${w.id}d${i}`, text: "…", start: h.start, end: h.end, disfluency: "hesitation", hidden: true };
    const before = (h.start + h.end) / 2 < (word.start + word.end) / 2;
    if (before) word = { ...word, start: Math.max(word.start, h.end) };
    else word = { ...word, end: Math.min(word.end, h.start) };
    out.push(mark);
  });
  // A palavra não pode sumir: se a hesitação a engoliu, fica a original.
  if (word.end - word.start < 0.12) return [w];
  return [...out, word].sort((a, b) => a.start - b.start);
}

/** Marca uma tentativa abandonada como "palavra" separada, antes da palavra que ficou. */
export function splitFalseStart(w: Word, cut: { start: number; end: number }): Word[] {
  return [
    { id: `${w.id}f`, text: "…", start: cut.start, end: cut.end, disfluency: "false_start", hidden: true },
    { ...w, start: cut.end + 0.02 },
  ];
}
