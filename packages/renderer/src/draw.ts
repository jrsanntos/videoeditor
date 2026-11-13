import type { Look } from "@videoeditor/core";

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

/**
 * Mola amortecida (resposta ao degrau): 0→1 com a física de uma mola de
 * verdade. `x` é o progresso 0–1 do movimento; com amortecimento < 1 passa
 * um pouco do alvo e assenta — o "pop" que uma curva bezier não dá.
 */
export function spring(x: number, opts: { damping?: number; frequency?: number } = {}): number {
  const t = clamp01(x);
  if (t === 0 || t === 1) return t;
  const zeta = opts.damping ?? 0.55;
  const w0 = (opts.frequency ?? 2.2) * Math.PI * 2;
  if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const raw = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  // Garante chegada exata em 1 no fim do intervalo.
  return raw + (1 - raw) * t * t * t;
}

/** Interpolação linear de `x` (em [a, b]) para [from, to], presa aos extremos. */
export function interpolate(x: number, a: number, b: number, from: number, to: number, ease: (k: number) => number = (k) => k): number {
  const k = b === a ? (x >= b ? 1 : 0) : clamp01((x - a) / (b - a));
  return from + (to - from) * ease(k);
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

// Unidade de layout do quadro em desenho (1u = 1px num quadro de 1080 no lado menor).
let unit = 1;
export const setUnit = (u: number) => {
  unit = u;
};
export const getUnit = () => unit;

/**
 * Desfoque de movimento. Usa ctx.filter onde existe; onde não existe não faz
 * nada, e a transição fica só com o deslocamento e a opacidade que quem chama
 * já aplica.
 */
export type LookSpec = {
  /** Curva tonal (filtros CSS): contraste, saturação, brilho, sépia. 1/0 = neutro. */
  contrast: number;
  saturate: number;
  brightness: number;
  sepia: number;
  /** Camadas de cor por cima do vídeo (o "split-toning" da LUT). */
  layers: { op: GlobalCompositeOperation; color: string; alpha: number }[];
};

/**
 * Tratamentos de cor (LUTs aproximadas em Canvas 2D): uma curva tonal por
 * filtro mais camadas de cor em soft-light/overlay, que tingem sombras e
 * luzes de forma diferente. O mesmo código roda no preview e na exportação.
 */
export const LOOKS: Record<Exclude<Look["grade"], "none">, LookSpec> = {
  // Sombras frias (teal), peles e luzes quentes (laranja): o look de ação/tático.
  tactical_teal_orange: { contrast: 1.2, saturate: 1.12, brightness: 0.98, sepia: 0, layers: [{ op: "soft-light", color: "#0b6b73", alpha: 0.42 }, { op: "overlay", color: "#ff8a3d", alpha: 0.13 }] },
  // Prata retida: contraste duro e cor lavada.
  bleach_bypass: { contrast: 1.4, saturate: 0.42, brightness: 1.03, sepia: 0, layers: [{ op: "soft-light", color: "#7d8a91", alpha: 0.3 }] },
  // Quente e limpo: documentário moderno.
  warm_cinematic: { contrast: 1.1, saturate: 1.06, brightness: 1.01, sepia: 0.14, layers: [{ op: "soft-light", color: "#ffb26b", alpha: 0.2 }, { op: "multiply", color: "#fff4e6", alpha: 0.35 }] },
  // Só "acorda" a imagem: creator/viral.
  clean_punch: { contrast: 1.13, saturate: 1.24, brightness: 1.03, sepia: 0, layers: [] },
};

const mix1 = (v: number, k: number, neutral = 1) => neutral + (v - neutral) * k;

/** Filtro CSS do tratamento, para aplicar ao desenhar o vídeo. "none" quando não há. */
export function lookFilter(look: Look): string {
  if (look.grade === "none" || look.intensity <= 0) return "none";
  const s = LOOKS[look.grade];
  const k = look.intensity;
  return `contrast(${mix1(s.contrast, k).toFixed(3)}) saturate(${mix1(s.saturate, k).toFixed(3)}) brightness(${mix1(s.brightness, k).toFixed(3)})${s.sepia ? ` sepia(${(s.sepia * k).toFixed(3)})` : ""}`;
}

/** Camadas de cor do tratamento, por cima do vídeo já desenhado. */
export function drawLookLayers(ctx: Ctx2D, look: Look, width: number, height: number) {
  if (look.grade === "none" || look.intensity <= 0) return;
  ctx.save();
  for (const layer of LOOKS[look.grade].layers) {
    ctx.globalCompositeOperation = layer.op;
    ctx.globalAlpha = layer.alpha * look.intensity;
    ctx.fillStyle = layer.color;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

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
