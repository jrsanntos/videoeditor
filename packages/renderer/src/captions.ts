import { captionAlpha, captionBaseY, captionSuppression, placeCaption, timelineWords, type Box, type CaptionPreset, type CaptionStyle, type Project, type SafeArea, type TimeRange, type TimelineWord } from "@videoeditor/core";
import type { Rect } from "./camera";
import { clamp01, type Ctx2D, easeOutBack, easeOutCubic, font, interpolate, rgba, roundRect, spring, stage } from "./draw";

/**
 * Legendas: agrupamento, posicionamento e os estilos. Padrão da indústria:
 * na base do quadro (acima da interface de TikTok/Reels/Shorts), nunca na
 * frente do rosto, e fora da tela enquanto um card ou texto cinético está ativo.
 */

export type CaptionBox = { x: number; y: number; w: number; h: number; wordIds: string[] };

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

type PresetSpec = {
  name: string;
  size: number;
  weight: number;
  upper: boolean;
  /** Teto de palavras por bloco, seja qual for o `maxWords` do projeto. */
  maxWords?: number;
  /** Fração da largura útil que a linha pode ocupar. */
  maxWidth: number;
};

export const CAPTION_PRESETS: Record<CaptionPreset, PresetSpec> = {
  // Submagic/Hormozi: 2–3 palavras, palavra ativa 1,18x na cor de destaque, sombra dura, rotação alternada.
  viral_pop: { name: "Viral Pop", size: 80, weight: 900, upper: true, maxWords: 3, maxWidth: 0.94 },
  // Pílula colorida que desliza atrás da palavra falada.
  karaoke_pill: { name: "Pílula karaokê", size: 60, weight: 800, upper: false, maxWords: 5, maxWidth: 0.94 },
  // Contorno espesso, entrada elástica, números e palavras-chave em destaque.
  comic_bounce: { name: "Comic Bounce", size: 76, weight: 900, upper: true, maxWords: 4, maxWidth: 0.94 },
  // Caixa translúcida escura, tipografia limpa.
  editorial_clean: { name: "Editorial", size: 50, weight: 600, upper: false, maxWidth: 0.9 },
  neon_subtitle: { name: "Neon", size: 62, weight: 800, upper: true, maxWords: 4, maxWidth: 0.92 },
  // Legenda de cinema: discreta, na base.
  minimal_cinema: { name: "Cinema discreto", size: 42, weight: 500, upper: false, maxWidth: 0.78 },
  // Os três originais.
  karaoke: { name: "Karaokê", size: 68, weight: 900, upper: true, maxWidth: 0.96 },
  bold: { name: "Negrito", size: 68, weight: 900, upper: true, maxWidth: 0.96 },
  clean: { name: "Limpa", size: 52, weight: 600, upper: false, maxWidth: 0.96 },
};

const SPACING: Partial<Record<CaptionPreset, number>> = { viral_pop: 3, comic_bounce: 2.4, karaoke_pill: 1.6, neon_subtitle: 1.3 };

const groupCache = new WeakMap<Project, CaptionGroup[]>();

/**
 * Legendas derivadas da transcrição. O agrupamento usa sempre os tempos e as
 * palavras originais — esconder, reescrever ou deslocar uma legenda não muda
 * onde as outras quebram.
 */
export function captionGroups(project: Project): CaptionGroup[] {
  const cached = groupCache.get(project);
  if (cached) return cached;
  const max = Math.min(project.captions.style.maxWords, CAPTION_PRESETS[project.captions.style.preset].maxWords ?? Infinity);
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

const suppressionCache = new WeakMap<Project, TimeRange[]>();
/** Opacidade da legenda em `t`: some (com fade) enquanto um card ou texto cinético está na tela. */
export function captionOpacity(project: Project, t: number): number {
  let ranges = suppressionCache.get(project);
  if (!ranges) suppressionCache.set(project, (ranges = captionSuppression(project)));
  return captionAlpha(ranges, t);
}

/** Palavra que merece destaque automático: número, ou palavra dita com força. */
const isKeyword = (w: TimelineWord) => /\d/.test(w.text) || (w.energy ?? 0) >= 4;

export type CaptionDrawOptions = {
  onCaption?: (box: CaptionBox) => void;
  editCaptionId?: string | null;
  /** Textos de componentes neste quadro, em pixels. */
  busy: Rect[];
  /** Caixa do rosto neste quadro, em pixels (já com a câmera aplicada). null = sem rosto medido ou coberto. */
  face: Rect | null;
  /** Altura das barras cinemáticas neste quadro: a legenda fica acima delas. */
  letterbox?: number;
};

/** Desenha a legenda do instante `t`. Devolve a caixa desenhada (ou null). */
export function drawCaptions(ctx: Ctx2D, project: Project, t: number, u: number, safe: SafeArea, o: CaptionDrawOptions): CaptionBox | null {
  const alpha = captionOpacity(project, t);
  if (alpha <= 0) return null;
  const groups = captionGroups(project).filter((g) => !g.hidden);
  const group = groups.find((g, i) => {
    const next = groups[i + 1];
    return t >= g.start && t < Math.min(g.end + 0.35, next ? next.start : Infinity);
  });
  if (!group) return null;
  const style: CaptionStyle = project.captions.style;
  const spec = CAPTION_PRESETS[style.preset];
  const { width, height } = project;
  let size = spec.size * u * style.fontScale;
  const texts = group.words.map((w) => (spec.upper ? w.text.toUpperCase() : w.text));

  const measure = () => {
    ctx.font = font(spec.weight, size);
    // Estilos em que a palavra ativa cresce, ganha contorno espesso ou uma pílula precisam de mais ar entre as palavras.
    const space = ctx.measureText(" ").width * (SPACING[style.preset] ?? 1);
    const widths = texts.map((s) => ctx.measureText(s).width);
    return { space, widths, total: widths.reduce((a, b) => a + b, 0) + space * (texts.length - 1) };
  };
  let m = measure();
  // As legendas ficam dentro da área segura: nada sob os botões e a descrição do app.
  const maxWidth = (width - safe.left - safe.right) * spec.maxWidth;
  if (m.total > maxWidth) {
    size *= maxWidth / m.total;
    m = measure();
  }
  const half = size * 0.85;
  const padX = size * 0.5;
  const cx = safe.left + (width - safe.left - safe.right) / 2;
  const bars = o.letterbox ?? 0;
  const desired =
    style.y !== undefined
      ? Math.min(height - size, Math.max(size, style.y * height))
      : style.position === "top"
        ? safe.top + size * 1.4
        : style.position === "center"
          ? height * 0.5
          : height * captionBaseY(project.aspectRatio);
  const frac = (r: Rect): Box => ({ x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height });
  // Colisões: a legenda nunca fica na frente do rosto nem por cima do texto de um componente.
  const cy =
    placeCaption({
      cx: cx / width,
      cy: Math.min(desired, height - bars - half - 8 * u) / height,
      half: half / height,
      width: (m.total + padX * 2) / width,
      safeTop: (Math.max(safe.top, bars) + 4 * u) / height,
      maxBottom: (height - Math.max(bars, safe.bottom * 0.45)) / height,
      busy: o.busy.map(frac),
      face: o.face ? frac(o.face) : null,
    }) * height;

  const box: CaptionBox = { x: cx - m.total / 2 - padX, y: cy - half, w: m.total + padX * 2, h: half * 2, wordIds: group.wordIds };
  o.onCaption?.(box);
  if (o.editCaptionId && o.editCaptionId === group.wordIds[0]) {
    ctx.save();
    ctx.strokeStyle = "rgba(129,140,248,0.95)";
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([10 * u, 8 * u]);
    roundRect(ctx, box.x, box.y, box.w, box.h, 10 * u);
    ctx.stroke();
    ctx.restore();
  }

  const preset = style.preset;
  const enter = stage(t, group.start, 0.18);
  const pop = preset === "minimal_cinema" || preset === "editorial_clean" ? 1 : 0.9 + 0.1 * easeOutBack(enter);
  const fadeIn = preset === "minimal_cinema" || preset === "editorial_clean" ? easeOutCubic(stage(t, group.start, 0.15)) : 1;

  ctx.save();
  ctx.globalAlpha *= alpha * fadeIn;
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.font = font(spec.weight, size);

  // Posição (centro) de cada palavra na linha.
  const centers: number[] = [];
  let x = -m.total / 2;
  group.words.forEach((_, i) => {
    centers.push(x + m.widths[i]! / 2);
    x += m.widths[i]! + m.space;
  });
  const activeIndex = group.words.findIndex((w) => t >= w.start && t < w.end + 0.05);
  const lastSpoken = group.words.reduce((k, w, i) => (t >= w.start ? i : k), -1);

  if (preset === "clean" || preset === "editorial_clean") {
    // Caixa translúcida escura de cantos arredondados.
    ctx.fillStyle = preset === "clean" ? "rgba(15,23,42,0.78)" : "rgba(10,12,16,0.72)";
    roundRect(ctx, -m.total / 2 - padX, -half, m.total + padX * 2, half * 2, size * (preset === "clean" ? 0.35 : 0.22));
    ctx.fill();
    if (preset === "editorial_clean") {
      ctx.fillStyle = style.highlightColor;
      ctx.fillRect(-m.total / 2 - padX, -half, Math.max(3 * u, size * 0.07), half * 2);
    }
  }

  if (preset === "karaoke_pill" && lastSpoken >= 0) {
    // A pílula desliza da palavra anterior para a atual com uma mola curta.
    const cur = lastSpoken;
    const prev = Math.max(0, cur - 1);
    const k = cur === 0 ? 1 : spring(stage(t, group.words[cur]!.start, 0.2), { damping: 0.7, frequency: 1.1 });
    const px = interpolate(k, 0, 1, centers[prev]!, centers[cur]!);
    const pw = interpolate(k, 0, 1, m.widths[prev]!, m.widths[cur]!) + size * 0.5;
    const grow = cur === 0 ? easeOutBack(stage(t, group.words[0]!.start, 0.2)) : 1;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14 * u;
    ctx.shadowOffsetY = 4 * u;
    ctx.fillStyle = style.highlightColor;
    roundRect(ctx, px - (pw * grow) / 2, -size * 0.66, pw * grow, size * 1.32, size * 0.66);
    ctx.fill();
    ctx.restore();
  }

  group.words.forEach((w, i) => {
    const text = texts[i]!;
    const active = i === activeIndex;
    const spoken = t >= w.start;
    ctx.save();
    ctx.translate(centers[i]!, 0);
    switch (preset) {
      case "viral_pop": {
        // Palavra ativa cresce com mola até 1,18x, com rotação sutil alternada.
        const k = spoken ? spring(stage(t, w.start, 0.22), { damping: 0.45, frequency: 1.5 }) : 0;
        const hold = active ? 1 : spoken ? clamp01(1 - stage(t, w.end + 0.05, 0.12)) : 0;
        const scale = 1 + 0.18 * Math.min(k, 1.15) * hold;
        ctx.rotate((((i % 2 ? 1 : -1) * 2.5 * Math.PI) / 180) * hold);
        ctx.scale(scale, scale);
        // Sombra dura (sem desfoque), deslocada para baixo e para a direita.
        ctx.fillStyle = "#000";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = size * 0.2;
        ctx.strokeText(text, size * 0.06, size * 0.08);
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = hold > 0.5 ? style.highlightColor : style.color;
        ctx.fillText(text, 0, 0);
        break;
      }
      case "karaoke_pill": {
        const on = i === lastSpoken;
        if (!on) {
          ctx.shadowColor = "rgba(0,0,0,0.75)";
          ctx.shadowBlur = 10 * u;
          ctx.shadowOffsetY = 2 * u;
        }
        ctx.fillStyle = on ? "#0b0b10" : spoken ? style.color : rgba("#ffffff", 0.82);
        ctx.fillText(text, 0, 0);
        break;
      }
      case "comic_bounce": {
        // Cada palavra entra com efeito elástico quando é dita; antes disso fica esmaecida e menor.
        const k = spring(stage(t, w.start - 0.04, 0.34), { damping: 0.32, frequency: 1.7 });
        const key = isKeyword(w);
        const scale = (spoken ? 0.55 + 0.45 * k : 0.82) * (key && spoken ? 1.12 : 1);
        ctx.globalAlpha *= spoken ? 1 : 0.55;
        ctx.rotate(spoken ? ((1 - Math.min(k, 1)) * (i % 2 ? 6 : -6) * Math.PI) / 180 : 0);
        ctx.scale(scale, scale);
        ctx.lineWidth = size * 0.3;
        ctx.strokeStyle = "#0b0b10";
        ctx.strokeText(text, 0, size * 0.05);
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = key ? style.highlightColor : style.color;
        ctx.fillText(text, 0, 0);
        break;
      }
      case "editorial_clean": {
        ctx.fillStyle = style.color;
        ctx.globalAlpha *= spoken ? 1 : 0.62;
        ctx.fillText(text, 0, 0);
        break;
      }
      case "neon_subtitle": {
        // Brilho na cor de destaque; a palavra ativa acende mais.
        const flick = active ? 0.92 + 0.08 * Math.sin(t * 38) : 1;
        ctx.shadowColor = style.highlightColor;
        ctx.shadowBlur = (active ? 34 : 16) * u * flick;
        ctx.strokeStyle = rgba("#000000", 0.55);
        ctx.lineWidth = size * 0.08;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = active ? style.highlightColor : style.color;
        ctx.fillText(text, 0, 0);
        if (active) ctx.fillText(text, 0, 0);
        break;
      }
      case "minimal_cinema": {
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 8 * u;
        ctx.shadowOffsetY = 2 * u;
        ctx.fillStyle = style.color;
        ctx.fillText(text, 0, 0);
        break;
      }
      default: {
        if (preset !== "clean") {
          ctx.lineWidth = size * 0.22;
          ctx.strokeStyle = "rgba(0,0,0,0.92)";
          ctx.strokeText(text, 0, 0);
        }
        ctx.fillStyle = preset === "karaoke" ? (active ? style.highlightColor : spoken ? style.color : "rgba(255,255,255,0.72)") : style.color;
        ctx.fillText(text, 0, 0);
      }
    }
    ctx.restore();
  });
  ctx.restore();
  return box;
}
