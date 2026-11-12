import {
  FONT_PAIRS,
  mainClipAt,
  safeArea,
  timelineWords,
  type CaptionStyle,
  type MediaClip,
  type Project,
  type SafeArea,
  type TimelineWord,
} from "@videoeditor/core";
import { cameraAt, drawVideo, type Rect } from "./camera";
import { COMPONENTS } from "./components/library";
import { brandFonts, type Ctx2D, easeOutBack, font, roundRect, setActiveFonts, stage } from "./draw";

export type FrameSource = { image: CanvasImageSource; width: number; height: number };

export type RenderOptions = {
  /**
   * Máscara do apresentador para o quadro atual (alfa = pessoa), alinhada ao
   * quadro de origem. Só é pedida enquanto um componente que precisa dela está
   * na tela. null = ainda não disponível.
   */
  getPersonMask?: (clip: MediaClip, frame: FrameSource) => CanvasImageSource | null;
  /** Desenha as áreas seguras por cima (só no preview; nunca na exportação). */
  guides?: boolean;
};

// Tela auxiliar para recortar o apresentador (uma por tamanho de projeto).
let scratch: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null = null;
function scratchFor(width: number, height: number) {
  if (typeof OffscreenCanvas === "undefined") return null;
  if (!scratch || scratch.canvas.width !== width || scratch.canvas.height !== height) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    scratch = { canvas, ctx };
  }
  return scratch;
}

/**
 * O renderizador único: desenha o quadro do projeto no instante `t`.
 * Função pura de (estado, tempo, frame de origem) → pixels. É chamada a cada
 * requestAnimationFrame no preview e quadro a quadro na exportação.
 * Camadas: vídeo pela câmera virtual → componentes → legendas.
 */
export function renderFrame(
  ctx: Ctx2D,
  project: Project,
  t: number,
  getFrame: (clip: MediaClip) => FrameSource | null,
  options: RenderOptions = {},
) {
  const { width, height } = project;
  // 1u = 1px num quadro cujo lado menor tem 1080: o mesmo layout serve vertical e horizontal.
  const u = Math.min(width, height) / 1080;
  const safe = safeArea(project);
  const vertical = height > width;
  setActiveFonts(brandFonts(FONT_PAIRS[project.brand.fontPair]));
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const clip = mainClipAt(project, t);
  const frame = clip ? getFrame(clip) : null;
  let rect: Rect | null = null;
  if (frame) {
    rect = cameraAt(project, t, frame.width, frame.height);
    // A posição do quadro anterior dá a velocidade da câmera para o motion blur.
    drawVideo(ctx, frame.image, rect, cameraAt(project, Math.max(0, t - 1 / project.fps), frame.width, frame.height), u);
  }

  // Recorte do apresentador, montado no máximo uma vez por quadro e só se alguém pedir.
  let person: OffscreenCanvas | null | undefined;
  const personLayer = () => {
    if (person !== undefined) return person;
    person = null;
    const mask = clip && frame && rect ? (options.getPersonMask?.(clip, frame) ?? null) : null;
    const s = mask ? scratchFor(width, height) : null;
    if (mask && s && frame && rect) {
      s.ctx.globalCompositeOperation = "source-over";
      s.ctx.clearRect(0, 0, width, height);
      s.ctx.imageSmoothingQuality = "high";
      s.ctx.drawImage(mask, rect.x, rect.y, rect.w, rect.h);
      // Mantém do vídeo só o que a máscara cobre.
      s.ctx.globalCompositeOperation = "source-in";
      s.ctx.drawImage(frame.image, rect.x, rect.y, rect.w, rect.h);
      person = s.canvas;
    }
    return person;
  };

  // Trilhas são ordenadas de cima para baixo; desenha de baixo para cima.
  for (const track of [...project.tracks].reverse()) {
    if (track.kind !== "overlay") continue;
    for (const c of track.clips) {
      if (c.type !== "component" || t < c.start || t >= c.start + c.duration) continue;
      const def = COMPONENTS[c.component];
      if (!def) continue;
      const parsed = def.schema.safeParse(c.params);
      if (!parsed.success) continue;
      const hasPerson = def.needsPerson ? personLayer() !== null : false;
      ctx.save();
      def.draw({
        ctx,
        params: parsed.data,
        t: t - c.start,
        duration: c.duration,
        width,
        height,
        u,
        brand: project.brand,
        safe,
        vertical,
        hasPerson,
        drawPerson: () => {
          const layer = def.needsPerson ? personLayer() : null;
          if (!layer) return;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          if ("filter" in ctx) ctx.filter = "none";
          ctx.drawImage(layer, 0, 0);
          ctx.restore();
        },
      });
      ctx.restore();
    }
  }

  if (project.captions.enabled) drawCaptions(ctx, project, t, u, safe);
  if (options.guides) drawGuides(ctx, width, height, safe, u);
  ctx.restore();
}

/** Há, em `t`, algum componente que precisa do recorte do apresentador? */
export function needsPersonAt(project: Project, t: number): boolean {
  return personIntervals(project).some((r) => t >= r.start && t < r.end);
}

/** Trechos da timeline em que a segmentação é necessária (para preparar só esses quadros). */
export function personIntervals(project: Project): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const track of project.tracks)
    for (const c of track.clips)
      if (c.type === "component" && COMPONENTS[c.component]?.needsPerson) out.push({ start: c.start, end: c.start + c.duration });
  return out;
}

function drawGuides(ctx: Ctx2D, width: number, height: number, safe: SafeArea, u: number) {
  ctx.save();
  ctx.fillStyle = "rgba(244,63,94,0.16)";
  ctx.fillRect(0, 0, width, safe.top);
  ctx.fillRect(0, height - safe.bottom, width, safe.bottom);
  ctx.fillRect(0, safe.top, safe.left, height - safe.top - safe.bottom);
  ctx.fillRect(width - safe.right, safe.top, safe.right, height - safe.top - safe.bottom);
  ctx.strokeStyle = "rgba(244,63,94,0.8)";
  ctx.lineWidth = 2 * u;
  ctx.setLineDash([12 * u, 10 * u]);
  ctx.strokeRect(safe.left, safe.top, width - safe.left - safe.right, height - safe.top - safe.bottom);
  ctx.restore();
}

type CaptionGroup = { start: number; end: number; words: TimelineWord[] };
const groupCache = new WeakMap<Project, CaptionGroup[]>();

export function captionGroups(project: Project): CaptionGroup[] {
  const cached = groupCache.get(project);
  if (cached) return cached;
  const max = project.captions.style.maxWords;
  const groups: CaptionGroup[] = [];
  let cur: TimelineWord[] = [];
  const flush = () => {
    if (cur.length) groups.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
    cur = [];
  };
  for (const w of timelineWords(project)) {
    if (!w.text.trim()) continue;
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= max || w.start - prev.end > 0.6 || w.clipId !== prev.clipId && w.start - prev.end > 0.2 || /[.!?]$/.test(prev.text)))
      flush();
    cur.push(w);
  }
  flush();
  groupCache.set(project, groups);
  return groups;
}

function drawCaptions(ctx: Ctx2D, project: Project, t: number, u: number, safe: SafeArea) {
  const groups = captionGroups(project);
  const group = groups.find((g, i) => {
    const next = groups[i + 1];
    return t >= g.start && t < Math.min(g.end + 0.35, next ? next.start : Infinity);
  });
  if (!group) return;
  const style: CaptionStyle = project.captions.style;
  const { width, height } = project;
  const upper = style.preset !== "clean";
  const weight = style.preset === "clean" ? 600 : 900;
  let size = (style.preset === "clean" ? 52 : 68) * u * style.fontScale;
  const texts = group.words.map((w) => (upper ? w.text.toUpperCase() : w.text));

  const measure = () => {
    ctx.font = font(weight, size);
    const space = ctx.measureText(" ").width;
    const widths = texts.map((s) => ctx.measureText(s).width);
    return { space, widths, total: widths.reduce((a, b) => a + b, 0) + space * (texts.length - 1) };
  };
  let m = measure();
  // As legendas ficam dentro da área segura: nada sob os botões e a descrição do app.
  const maxWidth = (width - safe.left - safe.right) * 0.96;
  if (m.total > maxWidth) {
    size *= maxWidth / m.total;
    m = measure();
  }
  const cy = style.position === "top" ? safe.top + size * 1.4 : style.position === "center" ? height * 0.5 : height - safe.bottom - size * 1.1;
  const pop = 0.9 + 0.1 * easeOutBack(stage(t, group.start, 0.18));

  ctx.save();
  ctx.translate(safe.left + (width - safe.left - safe.right) / 2, cy);
  ctx.scale(pop, pop);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if (style.preset === "clean") {
    // Executive pill: caixa escura translúcida de cantos arredondados.
    ctx.fillStyle = "rgba(15,23,42,0.78)";
    roundRect(ctx, -m.total / 2 - size * 0.5, -size * 0.85, m.total + size, size * 1.7, size * 0.35);
    ctx.fill();
  }
  let x = -m.total / 2;
  group.words.forEach((w, i) => {
    const active = t >= w.start && t < w.end + 0.05;
    const spoken = t >= w.start;
    if (style.preset !== "clean") {
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = "rgba(0,0,0,0.92)";
      ctx.strokeText(texts[i]!, x, 0);
    }
    ctx.fillStyle =
      style.preset === "karaoke" ? (active ? style.highlightColor : spoken ? style.color : "rgba(255,255,255,0.72)") : style.color;
    ctx.fillText(texts[i]!, x, 0);
    x += m.widths[i]! + m.space;
  });
  ctx.restore();
}
