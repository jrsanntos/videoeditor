import type { AspectRatio, ComponentClip, Project, TimeRange } from "./schema";
import { clipEnd, type SubjectBox } from "./timeline";

/**
 * Guardrails espaciais: onde o rosto está, quando é close-up, onde sobra
 * espaço negativo e para onde a legenda vai. Tudo em frações do quadro (0–1),
 * puro e testável; o compositor só converte para pixels.
 */
export type Box = { x: number; y: number; w: number; h: number };

/** Acima disto (fração da altura do quadro) o rosto é close-up: texto atrás da cabeça fica ilegível. */
export const CLOSE_UP_FACE_HEIGHT = 0.35;

const intersects = (a: Box, b: Box, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w > b.x - pad && a.y < b.y + b.h + pad && a.y + a.h > b.y - pad;

/**
 * Caixa do rosto. Usa o tamanho medido pela segmentação quando existe; senão
 * estima pela distância entre o topo da cabeça e o centro do rosto.
 * `aspect` = largura ÷ altura do quadro.
 */
export function faceBox(s: SubjectBox, aspect = 9 / 16): Box {
  const h = s.faceH ?? Math.max(0.06, (s.faceY - s.y) / 0.55);
  const w = s.faceW ?? Math.min(Math.max(s.w, 0.05), (h * 0.78) / aspect);
  return { x: s.faceX - w / 2, y: s.faceY - h * 0.55, w, h };
}

/** Close-up próximo, ou rosto cortado na borda superior/lateral do quadro. */
export function isCloseUp(s: SubjectBox, aspect = 9 / 16): boolean {
  const f = faceBox(s, aspect);
  if (f.h > CLOSE_UP_FACE_HEIGHT) return true;
  // Cabeça encostada no topo = cortada pela borda. Idem nas laterais.
  return f.y <= 0.012 || f.x <= 0.005 || f.x + f.w >= 0.995;
}

export type FreeArea = Box & { side: "above" | "below" | "left" | "right" };

/**
 * Maior área livre fora da zona do rosto, dentro das margens seguras
 * (`safe` em frações). É para onde vai o texto quando não dá para pô-lo
 * atrás da cabeça.
 */
export function freeArea(s: SubjectBox | null, safe: { top: number; right: number; bottom: number; left: number }, aspect = 9 / 16): FreeArea {
  const inner: Box = { x: safe.left, y: safe.top, w: 1 - safe.left - safe.right, h: 1 - safe.top - safe.bottom };
  if (!s) return { ...inner, y: inner.y + inner.h * 0.55, h: inner.h * 0.45, side: "below" };
  const f = faceBox(s, aspect);
  const pad = 0.025;
  const right = inner.x + inner.w;
  const bottom = inner.y + inner.h;
  const options: FreeArea[] = [
    { side: "above", x: inner.x, y: inner.y, w: inner.w, h: f.y - pad - inner.y },
    { side: "below", x: inner.x, y: f.y + f.h + pad, w: inner.w, h: bottom - (f.y + f.h + pad) },
    { side: "left", x: inner.x, y: inner.y, w: f.x - pad - inner.x, h: inner.h },
    { side: "right", x: f.x + f.w + pad, y: inner.y, w: right - (f.x + f.w + pad), h: inner.h },
  ];
  // Texto precisa de largura: uma faixa estreita e alta vale menos que uma larga e baixa.
  const score = (a: FreeArea) => (a.w <= 0.12 || a.h <= 0.08 ? 0 : a.w * Math.min(a.h, a.w * aspect * 1.2));
  return options.reduce((best, a) => (score(a) > score(best) ? a : best), options[1]!);
}

export type DepthPlacement = { mode: "behind" } | { mode: "card"; area: FreeArea; reason: "close_up" | "no_mask" };

/**
 * Texto em profundidade (`depth_hook_title`): só vai para trás da pessoa
 * quando há recorte E o rosto deixa o texto legível. Em close-up, ou com o
 * rosto cortado na borda, vira cartão em primeiro plano na área livre.
 */
export function depthPlacement(s: SubjectBox | null, hasMask: boolean, safe: { top: number; right: number; bottom: number; left: number }, aspect = 9 / 16): DepthPlacement {
  if (s && isCloseUp(s, aspect)) return { mode: "card", area: freeArea(s, safe, aspect), reason: "close_up" };
  if (!hasMask) return { mode: "card", area: freeArea(s, safe, aspect), reason: "no_mask" };
  return { mode: "behind" };
}

/** Centro vertical padrão da legenda (fração do quadro): na base, acima da interface de TikTok/Reels/Shorts. */
export const captionBaseY = (aspect: AspectRatio) => (aspect === "9:16" ? 1 - 0.165 : 1 - 0.14);

export type CaptionPlacement = {
  /** Centro e meia-altura da legenda, e a largura total (frações). */
  cx: number;
  cy: number;
  half: number;
  width: number;
  safeTop: number;
  /** Limite inferior permitido para a borda de baixo da legenda. */
  maxBottom: number;
  /** Textos de componentes na tela. */
  busy: Box[];
  face: Box | null;
};

/**
 * Posição final (centro Y) da legenda. Duas regras, nesta ordem:
 * 1. nunca na frente do rosto — vai para a margem segura inferior ou superior livre;
 * 2. nunca por cima do texto de um componente — vai para o espaço livre mais próximo.
 */
export function placeCaption(o: CaptionPlacement): number {
  const rect = (y: number): Box => ({ x: o.cx - o.width / 2, y: y - o.half, w: o.width, h: o.half * 2 });
  const gap = 0.014;
  const inFrame = (y: number) => y - o.half >= o.safeTop && y + o.half <= o.maxBottom;
  const hitsFace = (y: number) => !!o.face && intersects(rect(y), o.face, gap);
  const hitsBusy = (y: number) => o.busy.some((b) => intersects(rect(y), b, gap / 2));
  const clear = (y: number) => inFrame(y) && !hitsFace(y) && !hitsBusy(y);
  if (clear(o.cy)) return o.cy;
  const candidates: number[] = [];
  if (o.face) candidates.push(o.face.y + o.face.h + gap + o.half, o.maxBottom - o.half, o.face.y - gap - o.half, o.safeTop + o.half);
  const hits = o.busy.filter((b) => intersects(rect(o.cy), b, gap / 2));
  if (hits.length) candidates.push(Math.max(...hits.map((b) => b.y + b.h)) + gap + o.half, Math.min(...hits.map((b) => b.y)) - gap - o.half);
  candidates.push(o.maxBottom - o.half, o.safeTop + o.half);
  const free = candidates.filter(clear).sort((a, b) => Math.abs(a - o.cy) - Math.abs(b - o.cy));
  if (free.length) return free[0]!;
  // Sem lugar perfeito: pelo menos fora do rosto.
  const offFace = candidates.filter((y) => inFrame(y) && !hitsFace(y)).sort((a, b) => Math.abs(a - o.cy) - Math.abs(b - o.cy));
  return offFace[0] ?? o.cy;
}

/** Componentes discretos que convivem com a legenda (ela só desvia deles). Os demais a suprimem. */
const CAPTION_FRIENDLY = new Set(["executive_lower_third", "lower_third", "tactical_hud_overlay", "step_progress_bar", "callout_pointer"]);

/** Card, infográfico ou texto cinético grande: enquanto está na tela, a legenda sai. */
export function suppressesCaptions(clip: ComponentClip): boolean {
  if (CAPTION_FRIENDLY.has(clip.component)) return false;
  return clip.params.keepCaptions !== true;
}

/** Trechos da timeline em que a legenda é suprimida por um componente. */
export function captionSuppression(project: Project): TimeRange[] {
  const out: TimeRange[] = [];
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (c.type !== "component" || !suppressesCaptions(c)) continue;
      if (!project.brand.showLowerThird && (c.component === "executive_lower_third" || c.component === "lower_third")) continue;
      out.push({ start: c.start, end: clipEnd(c) });
    }
  return out.sort((a, b) => a.start - b.start);
}

/** Opacidade da legenda em `t`: 0 durante um card, com fade de `fade` segundos antes e depois. */
export function captionAlpha(ranges: TimeRange[], t: number, fade = 0.2): number {
  let alpha = 1;
  for (const r of ranges) {
    if (t >= r.start && t < r.end) return 0;
    const d = t < r.start ? r.start - t : t - r.end;
    alpha = Math.min(alpha, d / fade);
  }
  return Math.max(0, Math.min(1, alpha));
}
