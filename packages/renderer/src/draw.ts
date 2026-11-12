export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x: number) => {
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
export const easeOutBack = (x: number) => {
  const c = clamp01(x);
  const k = 1.70158;
  return 1 + (k + 1) * Math.pow(c - 1, 3) + k * Math.pow(c - 1, 2);
};

/** 0→1 na entrada, 1 no meio, 1→0 na saída. */
export function presence(t: number, duration: number, inDur = 0.4, outDur = 0.3): number {
  const a = easeOutCubic(t / Math.min(inDur, duration / 2));
  const b = easeOutCubic((duration - t) / Math.min(outDur, duration / 2));
  return Math.min(a, b);
}

/** Progresso 0→1 de uma animação que começa em `delay` e dura `dur`. */
export const stage = (t: number, delay: number, dur: number) => clamp01((t - delay) / dur);

export const FONT = `Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
export const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${FONT}`;

export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Reduz o tamanho da fonte até o texto caber em `maxWidth`. Retorna o px usado. */
export function fitText(ctx: Ctx2D, text: string, weight: number, px: number, maxWidth: number): number {
  let size = px;
  ctx.font = font(weight, size);
  const w = ctx.measureText(text).width;
  if (w > maxWidth) {
    size = Math.max(8, (size * maxWidth) / w);
    ctx.font = font(weight, size);
  }
  return size;
}

export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
