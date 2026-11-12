import {
  clipsAt,
  mainClipAt,
  timelineWords,
  type CaptionStyle,
  type MediaClip,
  type Project,
  type TimelineWord,
} from "@videoeditor/core";
import { COMPONENTS } from "./components/library";
import { type Ctx2D, easeInOutCubic, easeOutBack, font, roundRect, stage } from "./draw";

export type FrameSource = { image: CanvasImageSource; width: number; height: number };

/**
 * O renderizador único: desenha o quadro do projeto no instante `t`.
 * Função pura de (estado, tempo, frame de origem) → pixels. É chamada a cada
 * requestAnimationFrame no preview e quadro a quadro na exportação.
 */
export function renderFrame(
  ctx: Ctx2D,
  project: Project,
  t: number,
  getFrame: (clip: MediaClip) => FrameSource | null,
) {
  const { width, height } = project;
  const u = height / 1080;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const clip = mainClipAt(project, t);
  const frame = clip ? getFrame(clip) : null;
  if (frame) {
    ctx.save();
    const zoom = zoomAt(project, t);
    if (zoom.scale !== 1) {
      const fx = zoom.x * width;
      const fy = zoom.y * height;
      ctx.translate(fx, fy);
      ctx.scale(zoom.scale, zoom.scale);
      ctx.translate(-fx, -fy);
    }
    const s = Math.min(width / frame.width, height / frame.height);
    const w = frame.width * s;
    const h = frame.height * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(frame.image, (width - w) / 2, (height - h) / 2, w, h);
    ctx.restore();
  }

  // Trilhas são ordenadas de cima para baixo; desenha de baixo para cima.
  for (const track of [...project.tracks].reverse()) {
    if (track.kind !== "overlay") continue;
    for (const c of track.clips) {
      if (c.type !== "component" || t < c.start || t >= c.start + c.duration) continue;
      const def = COMPONENTS[c.component];
      if (!def) continue;
      const parsed = def.schema.safeParse(c.params);
      if (!parsed.success) continue;
      ctx.save();
      def.draw({ ctx, params: parsed.data, t: t - c.start, duration: c.duration, width, height, u });
      ctx.restore();
    }
  }

  if (project.captions.enabled) drawCaptions(ctx, project, t, u);
  ctx.restore();
}

function zoomAt(project: Project, t: number) {
  const zooms = clipsAt(project, t, "zoom");
  const z = zooms[zooms.length - 1];
  if (!z) return { scale: 1, x: 0.5, y: 0.5 };
  const local = t - z.start;
  const k = z.ease > 0 ? Math.min(easeInOutCubic(local / z.ease), easeInOutCubic((z.duration - local) / z.ease)) : 1;
  return { scale: 1 + (z.scale - 1) * k, x: z.x, y: z.y };
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

function drawCaptions(ctx: Ctx2D, project: Project, t: number, u: number) {
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
  if (m.total > width * 0.88) {
    size *= (width * 0.88) / m.total;
    m = measure();
  }
  const cy = style.position === "top" ? height * 0.14 : style.position === "center" ? height * 0.5 : height * 0.84;
  const pop = 0.9 + 0.1 * easeOutBack(stage(t, group.start, 0.18));

  ctx.save();
  ctx.translate(width / 2, cy);
  ctx.scale(pop, pop);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if (style.preset === "clean") {
    ctx.fillStyle = "rgba(11,11,16,0.78)";
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
