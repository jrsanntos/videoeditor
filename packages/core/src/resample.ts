/**
 * Reamostragem em streaming (mono): recebe o áudio em pedaços, na taxa do
 * arquivo, e devolve na taxa pedida sem nunca ter o arquivo inteiro na memória.
 * É o que permite ler o áudio de um vídeo grande pedaço a pedaço.
 *
 * Filtro passa-baixas sinc com janela de Hann antes de reduzir a taxa: sem ele
 * os agudos acima da metade da taxa nova voltariam como chiado (aliasing) em
 * cima da voz, e é esse áudio que vai para a transcrição e para a medição de
 * pausas.
 */
const ZERO_CROSSINGS = 12;
const TABLE_STEPS = 256;

export type Resampler = {
  /** Entrega um pedaço de áudio; devolve o que já dá para calcular na taxa nova. */
  push: (input: Float32Array) => Float32Array;
  /** Fim do áudio: devolve o resto. */
  flush: () => Float32Array;
};

export function createResampler(inRate: number, outRate: number): Resampler {
  if (!(inRate > 0) || !(outRate > 0)) throw new Error("taxa de amostragem inválida");
  if (inRate === outRate) return { push: (x) => x.slice(), flush: () => new Float32Array(0) };
  const ratio = inRate / outRate;
  // Corte em 90% da menor das duas metades de taxa; o núcleo é medido em amostras de ENTRADA.
  const cutoff = 0.9 * Math.min(1, 1 / ratio);
  const half = Math.ceil(ZERO_CROSSINGS / cutoff);
  // Núcleo (sinc × Hann) tabelado: |x| de 0 a `half`, em passos de 1/TABLE_STEPS de amostra.
  const table = new Float32Array(half * TABLE_STEPS + 2);
  for (let i = 0; i < table.length; i++) {
    const x = i / TABLE_STEPS;
    const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
    table[i] = x >= half ? 0 : cutoff * s * (0.5 + 0.5 * Math.cos((Math.PI * x) / half));
  }

  /** Amostras de entrada ainda necessárias; `base` é o índice absoluto da primeira. */
  let pending = new Float32Array(0);
  let base = 0;
  let total = 0;
  /** Próxima amostra de saída a calcular. */
  let n = 0;

  const run = (end: boolean): Float32Array => {
    // Uma saída em p só pode ser calculada quando a entrada até p + half chegou (ou o áudio acabou).
    const lastIn = end ? total - 1 : total - 1 - half;
    const count = Math.max(0, Math.floor(lastIn / ratio) - n + 1);
    const out = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const p = (n + k) * ratio;
      const from = Math.max(base, Math.ceil(p - half));
      const to = Math.min(total - 1, Math.floor(p + half));
      let acc = 0;
      for (let i = from; i <= to; i++) acc += pending[i - base]! * table[Math.round(Math.abs(i - p) * TABLE_STEPS)]!;
      out[k] = acc;
    }
    n += count;
    // O que ficou para trás do núcleo da próxima saída não é mais lido.
    const keepFrom = Math.max(base, Math.min(total, Math.floor(n * ratio - half)));
    if (keepFrom > base) {
      pending = pending.slice(keepFrom - base);
      base = keepFrom;
    }
    return out;
  };

  return {
    push(input) {
      if (input.length) {
        const next = new Float32Array(pending.length + input.length);
        next.set(pending, 0);
        next.set(input, pending.length);
        pending = next;
        total += input.length;
      }
      return run(false);
    },
    flush: () => run(true),
  };
}

/** Junta pedaços num vetor só. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
