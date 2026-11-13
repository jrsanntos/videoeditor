/**
 * Pós-processamento da máscara de segmentação de pessoa (confiança 0–1 por
 * pixel). Três passos, nesta ordem, para um recorte limpo de estúdio:
 * 1. suavização temporal — mistura com a máscara do quadro anterior (sem tremor nas bordas do cabelo e dos ombros);
 * 2. fechamento morfológico — dilata e erode (fecha buracos internos na silhueta);
 * 3. feathering — desfoque gaussiano leve na borda alfa.
 * Funções puras sobre Float32Array: rodam no navegador e nos testes.
 */

/** Mistura a máscara atual com a anterior. `keep` = quanto do quadro anterior fica (0 desliga). */
export function temporalSmooth(current: Float32Array, previous: Float32Array | null, keep = 0.4): Float32Array {
  if (!previous || previous.length !== current.length || keep <= 0) return current;
  const out = new Float32Array(current.length);
  for (let i = 0; i < current.length; i++) {
    const c = current[i]!;
    const p = previous[i]!;
    // Onde a pessoa se moveu de verdade (grande diferença) o quadro atual manda: sem rastro fantasma.
    const k = Math.abs(c - p) > 0.6 ? keep * 0.25 : keep;
    out[i] = c * (1 - k) + p * k;
  }
  return out;
}

function morph(src: Float32Array, w: number, h: number, radius: number, pick: (a: number, b: number) => number): Float32Array {
  // Separável: horizontal e depois vertical (elemento estruturante quadrado).
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x]!;
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) v = pick(v, src[y * w + xx]!);
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]!;
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]!);
      }
      out[y * w + x] = v;
    }
  return out;
}

/** Fechamento morfológico (dilatação seguida de erosão): elimina buracos menores que ~2×radius dentro da silhueta. */
export function closeMask(mask: Float32Array, w: number, h: number, radius = 2): Float32Array {
  if (radius <= 0) return mask;
  return morph(morph(mask, w, h, radius, Math.max), w, h, radius, Math.min);
}

/** Desfoque gaussiano separável (sigma em pixels da máscara): a borda alfa fica suave, sem serrilhado. */
export function featherMask(mask: Float32Array, w: number, h: number, sigma = 1.75): Float32Array {
  if (sigma <= 0) return mask;
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel: number[] = [];
  let sum = 0;
  for (let d = -radius; d <= radius; d++) {
    const k = Math.exp(-(d * d) / (2 * sigma * sigma));
    kernel.push(k);
    sum += k;
  }
  const tmp = new Float32Array(mask.length);
  const out = new Float32Array(mask.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -radius; d <= radius; d++) v += mask[y * w + Math.min(w - 1, Math.max(0, x + d))]! * kernel[d + radius]!;
      tmp[y * w + x] = v / sum;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let d = -radius; d <= radius; d++) v += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x]! * kernel[d + radius]!;
      out[y * w + x] = v / sum;
    }
  return out;
}

/** Curva em S da confiança para alfa: miolo opaco, fundo limpo, transição suave. */
export const maskAlpha = (confidence: number) => {
  const v = Math.min(1, Math.max(0, (confidence - 0.35) / 0.3));
  return v * v * (3 - 2 * v);
};

/**
 * Pipeline completo. `featherPx` é o desfoque desejado em pixels do VÍDEO
 * (1,5–2 px); `scale` = largura da máscara ÷ largura do vídeo, para converter.
 */
export function refineMask(confidence: Float32Array, w: number, h: number, opts: { previous?: Float32Array | null; featherPx?: number; scale?: number; closeRadius?: number } = {}): { alpha: Float32Array; smoothed: Float32Array } {
  const smoothed = temporalSmooth(confidence, opts.previous ?? null);
  const hard = new Float32Array(smoothed.length);
  for (let i = 0; i < smoothed.length; i++) hard[i] = maskAlpha(smoothed[i]!);
  const closed = closeMask(hard, w, h, opts.closeRadius ?? 2);
  // Na resolução da máscara o desfoque é proporcionalmente menor, com um mínimo que ainda suaviza o serrilhado.
  const sigma = Math.max(0.7, (opts.featherPx ?? 1.75) * (opts.scale ?? 1));
  return { alpha: featherMask(closed, w, h, sigma), smoothed };
}
