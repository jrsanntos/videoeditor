import {
  FONT_PAIRS,
  isFullscreen,
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
  /**
   * Edição direta no preview: os textos deste clip informam onde estão na tela
   * (`onRegion`) e ganham um contorno. Nunca usado na exportação.
   */
  editClipId?: string | null;
  onRegion?: (region: EditRegion) => void;
  /** Onde a legenda do instante atual foi desenhada, para arrastar e editar no preview. */
  onCaption?: (box: CaptionBox) => void;
  /** Legenda selecionada (id da primeira palavra): ganha um contorno. */
  editCaptionId?: string | null;
};

/** Um texto editável de um componente, em pixels do quadro do projeto. */
export type EditRegion = { clipId: string; key: string; x: number; y: number; w: number; h: number };
export type CaptionBox = { x: number; y: number; w: number; h: number; wordIds: string[] };

/** Componentes de tarja (nome/cargo): somem quando o Brand Kit desliga a tarja. */
export const LOWER_THIRD_IDS = new Set(["executive_lower_third", "lower_third"]);

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

  // Onde há texto de componentes neste quadro: as legendas desviam para não ficar por cima.
  const busy: Rect[] = [];
  let fullscreenOn = false;
  // Trilhas são ordenadas de cima para baixo; desenha de baixo para cima.
  for (const track of [...project.tracks].reverse()) {
    if (track.kind !== "overlay") continue;
    for (const c of track.clips) {
      if (c.type !== "component" || t < c.start || t >= c.start + c.duration) continue;
      const def = COMPONENTS[c.component];
      if (!def) continue;
      if (!project.brand.showLowerThird && LOWER_THIRD_IDS.has(c.component)) continue;
      const parsed = def.schema.safeParse(c.params);
      if (!parsed.success) continue;
      const hasPerson = def.needsPerson ? personLayer() !== null : false;
      const st = c.style;
      const brand = st
        ? {
            ...project.brand,
            ...(st.primaryColor ? { primaryColor: st.primaryColor } : {}),
            ...(st.textColor ? { textColor: st.textColor } : {}),
            ...(st.backgroundColor ? { backgroundColor: st.backgroundColor } : {}),
          }
        : project.brand;
      const clipFonts = st?.fontPair ? FONT_PAIRS[st.fontPair as keyof typeof FONT_PAIRS] : undefined;
      if (clipFonts) setActiveFonts(brandFonts(clipFonts));
      const editing = options.editClipId === c.id;
      const regions: EditRegion[] = [];
      ctx.save();
      // Posição e tamanho escolhidos pelo usuário; cenas de tela cheia ficam onde estão.
      if (st && !isFullscreen(c) && (st.dx || st.dy || st.scale !== 1)) {
        ctx.translate(width / 2 + st.dx * width, height / 2 + st.dy * height);
        ctx.scale(st.scale, st.scale);
        ctx.translate(-width / 2, -height / 2);
      }
      def.draw({
        region: (key, x, y, w, h) => {
          const m = ctx.getTransform();
          const xs = [x, x + w].flatMap((px) => [y, y + h].map((py) => m.a * px + m.c * py + m.e));
          const ys = [x, x + w].flatMap((px) => [y, y + h].map((py) => m.b * px + m.d * py + m.f));
          const x0 = Math.min(...xs);
          const y0 = Math.min(...ys);
          regions.push({ clipId: c.id, key, x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 });
        },
        ctx,
        params: parsed.data,
        t: t - c.start,
        duration: c.duration,
        width,
        height,
        u,
        brand,
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
      if (clipFonts) setActiveFonts(brandFonts(FONT_PAIRS[project.brand.fontPair]));
      if (isFullscreen(c)) fullscreenOn = true;
      else for (const r of regions) busy.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      // Chave vazia = área ocupada (não é um texto editável).
      for (const r of regions) if (r.key) options.onRegion?.(r);
      if (editing) {
        // Contorno dos textos do clip selecionado: mostra o que dá para arrastar e reescrever.
        ctx.save();
        ctx.strokeStyle = "rgba(154,134,255,0.95)";
        ctx.lineWidth = 3 * u;
        ctx.setLineDash([10 * u, 8 * u]);
        for (const r of regions) {
          if (!r.key) continue;
          const pad = 8 * u;
          roundRect(ctx, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, 8 * u);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Cena de tela cheia já traz a frase em tipografia própria: a legenda sai enquanto ela está na tela.
  if (project.captions.enabled && !fullscreenOn) drawCaptions(ctx, project, t, u, safe, options, busy);
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

export type CaptionGroup = {
  /** Tempos na timeline, já com o deslocamento da legenda. */
  start: number;
  end: number;
  /** Palavras visíveis (com texto e não escondidas), com os tempos já deslocados. */
  words: TimelineWord[];
  /** Todas as palavras do grupo, para editar a legenda inteira. */
  wordIds: string[];
  text: string;
  hidden: boolean;
  shift: number;
};
const groupCache = new WeakMap<Project, CaptionGroup[]>();

/**
 * Legendas derivadas da transcrição. O agrupamento usa sempre os tempos e as
 * palavras originais — esconder, reescrever ou deslocar uma legenda não muda
 * onde as outras quebram.
 */
export function captionGroups(project: Project): CaptionGroup[] {
  const cached = groupCache.get(project);
  if (cached) return cached;
  const max = project.captions.style.maxWords;
  const groups: CaptionGroup[] = [];
  let cur: TimelineWord[] = [];
  const flush = () => {
    if (cur.length) {
      const shift = cur[0]!.shift ?? 0;
      const words = cur.filter((w) => !w.hidden && w.text.trim()).map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
      groups.push({
        start: cur[0]!.start + shift,
        end: cur[cur.length - 1]!.end + shift,
        words,
        wordIds: cur.map((w) => w.id),
        text: cur
          .map((w) => w.text.trim())
          .filter(Boolean)
          .join(" "),
        hidden: !words.length,
        shift,
      });
    }
    cur = [];
  };
  for (const w of timelineWords(project)) {
    const prev = cur[cur.length - 1];
    if (prev && (cur.length >= max || w.start - prev.end > 0.6 || (w.clipId !== prev.clipId && w.start - prev.end > 0.2) || /[.!?]$/.test(prev.text)))
      flush();
    cur.push(w);
  }
  flush();
  groups.sort((a, b) => a.start - b.start);
  groupCache.set(project, groups);
  return groups;
}

function drawCaptions(ctx: Ctx2D, project: Project, t: number, u: number, safe: SafeArea, options: RenderOptions, busy: Rect[]) {
  const groups = captionGroups(project).filter((g) => !g.hidden);
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
  let cy =
    style.y !== undefined
      ? Math.min(height - size, Math.max(size, style.y * height))
      : style.position === "top"
        ? safe.top + size * 1.4
        : style.position === "center"
          ? height * 0.5
          : height - safe.bottom - size * 1.1;
  const cx = safe.left + (width - safe.left - safe.right) / 2;
  // Controle de colisão: se a legenda cairia sobre o texto de um componente, vai para o espaço livre mais próximo.
  const half = size * 0.85;
  const gap = 26 * u;
  const hits = busy.filter((r) => r.x < cx + m.total / 2 && r.x + r.w > cx - m.total / 2 && r.y < cy + half + gap / 2 && r.y + r.h > cy - half - gap / 2);
  if (hits.length) {
    const below = Math.max(...hits.map((r) => r.y + r.h)) + gap + half;
    const above = Math.min(...hits.map((r) => r.y)) - gap - half;
    const free = (y: number) => y - half >= safe.top && y + half <= height - safe.bottom * 0.6 && !busy.some((r) => r.x < cx + m.total / 2 && r.x + r.w > cx - m.total / 2 && r.y < y + half && r.y + r.h > y - half);
    const options2 = [below, above].filter(free).sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy));
    if (options2.length) cy = options2[0]!;
  }
  const box: CaptionBox = { x: cx - m.total / 2 - size * 0.5, y: cy - size * 0.85, w: m.total + size, h: size * 1.7, wordIds: group.wordIds };
  options.onCaption?.(box);
  if (options.editCaptionId && options.editCaptionId === group.wordIds[0]) {
    ctx.save();
    ctx.strokeStyle = "rgba(129,140,248,0.95)";
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([10 * u, 8 * u]);
    roundRect(ctx, box.x, box.y, box.w, box.h, 10 * u);
    ctx.stroke();
    ctx.restore();
  }
  const pop = 0.9 + 0.1 * easeOutBack(stage(t, group.start, 0.18));

  ctx.save();
  ctx.translate(cx, cy);
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
