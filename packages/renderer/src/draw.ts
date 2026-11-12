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

/**
 * Curva cubic-bezier (mesma definição do CSS): devolve a função de easing.
 * Resolve x(t) por Newton com bisseção de reserva.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const fy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dfx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    const target = clamp01(x);
    if (target === 0 || target === 1) return target;
    let t = target;
    for (let i = 0; i < 6; i++) {
      const d = dfx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (fx(t) - target) / d;
    }
    if (!(t >= 0 && t <= 1) || Math.abs(fx(t) - target) > 1e-4) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        t = (lo + hi) / 2;
        if (fx(t) < target) lo = t;
        else hi = t;
      }
    }
    return fy(t);
  };
}

/** Curvas da casa: movimentos decididos, que chegam rápido e assentam. */
export const EASE = {
  /** Entrada de elementos: dispara e desacelera forte (expo out). */
  snap: cubicBezier(0.16, 1, 0.3, 1),
  /** Movimentos de câmera e trocas: acelera e freia (in-out agressivo). */
  swift: cubicBezier(0.76, 0, 0.24, 1),
  /** Avanço lento e contínuo (creep zoom). */
  glide: cubicBezier(0.3, 0.1, 0.5, 1),
};

/** Famílias do Brand Kit, já com substitutas para quando a fonte ainda não carregou. */
export type Fonts = { sans: string; serif: string };
export const DEFAULT_FONTS: Fonts = {
  sans: `"Inter", "Segoe UI", system-ui, -apple-system, sans-serif`,
  serif: `"Instrument Serif", Georgia, "Times New Roman", serif`,
};
export const brandFonts = (pair: { sans: string; serif: string }): Fonts => ({
  sans: `"${pair.sans}", "Segoe UI", system-ui, -apple-system, sans-serif`,
  serif: `"${pair.serif}", Georgia, "Times New Roman", serif`,
});

// Fontes do quadro em desenho; o compositor define antes de chamar os componentes.
let active: Fonts = DEFAULT_FONTS;
export const setActiveFonts = (f: Fonts) => {
  active = f;
};
export const font = (weight: number, px: number) => `${weight} ${Math.round(px)}px ${active.sans}`;
export const serifFont = (px: number) => `italic 400 ${Math.round(px)}px ${active.serif}`;

/**
 * Desfoque de movimento. Usa ctx.filter onde existe; onde não existe não faz
 * nada, e a transição fica só com o deslocamento e a opacidade que quem chama
 * já aplica.
 */
export const supportsFilter = (ctx: Ctx2D) => typeof (ctx as { filter?: unknown }).filter === "string";
export function setBlur(ctx: Ctx2D, px: number) {
  if (!supportsFilter(ctx)) return;
  ctx.filter = px >= 0.5 ? `blur(${px.toFixed(1)}px)` : "none";
}

/**
 * Entrada com deslocamento, opacidade e desfoque proporcional à velocidade:
 * `p` é o progresso 0→1 já com easing; (dx, dy) é de onde o elemento vem.
 */
export function enter(ctx: Ctx2D, p: number, dx: number, dy: number) {
  const rest = 1 - p;
  ctx.translate(dx * rest, dy * rest);
  ctx.globalAlpha *= clamp01(p * 1.6);
  // Só nos quadros de movimento rápido: com a curva snap, o começo da entrada.
  if (rest > 0.04) setBlur(ctx, Math.min(Math.hypot(dx, dy) * rest * 0.22, 28));
}

/** Converte #RRGGBB em rgba(). */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

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
