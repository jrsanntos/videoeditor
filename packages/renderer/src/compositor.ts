import {
  depthPlacement,
  faceBox,
  FONT_PAIRS,
  isFullscreen,
  mainClipAt,
  projectDuration,
  sourceTimeAt,
  subjectAt,
  safeArea,
  type BrollClip,
  type MediaClip,
  type Project,
  type SafeArea,
} from "@videoeditor/core";
import { backdropBlur, drawLetterbox, drawVignette, letterboxHeight } from "./background";
import { cameraAt, drawVideo, impactAt, type Rect } from "./camera";
import { drawCaptions, type CaptionBox } from "./captions";
import { COMPONENTS } from "./components/library";
import { brandFonts, clamp01, type Ctx2D, drawLookLayers, EASE, lookFilter, roundRect, setActiveFonts, setUnit, stage } from "./draw";

export type FrameSource = { image: CanvasImageSource; width: number; height: number };

export type RenderOptions = {
  /**
   * Máscara do apresentador para o quadro atual (alfa = pessoa), alinhada ao
   * quadro de origem. Só é pedida enquanto um componente que precisa dela está
   * na tela. null = ainda não disponível.
   */
  getPersonMask?: (clip: MediaClip, frame: FrameSource) => CanvasImageSource | null;
  /** Quadro atual de uma mídia de contexto (vídeo ou imagem). null = ainda não disponível. */
  getBrollFrame?: (clip: BrollClip, localTime: number) => FrameSource | null;
  /** Só para a sonda de layout (sem canvas de verdade): considera que o recorte do apresentador existe. */
  assumePerson?: boolean;
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
  setUnit(u);
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const clip = mainClipAt(project, t);
  const frame = clip ? getFrame(clip) : null;
  const look = project.look;
  let rect: Rect | null = null;
  if (frame) {
    rect = cameraAt(project, t, frame.width, frame.height);
    // A posição do quadro anterior dá a velocidade da câmera para o motion blur.
    drawVideo(ctx, frame.image, rect, cameraAt(project, Math.max(0, t - 1 / project.fps), frame.width, frame.height), u, lookFilter(look));
  }
  const subject = subjectAt(project, t);
  const safeFrac = { top: safe.top / height, right: safe.right / width, bottom: safe.bottom / height, left: safe.left / width };

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
  let brollCover = false;

  // Mídia de contexto: por cima do vídeo falado, por baixo dos componentes e das legendas.
  if (options.getBrollFrame)
    for (const track of [...project.tracks].reverse()) {
      if (track.kind !== "broll") continue;
      for (const c of track.clips) {
        if (c.type !== "broll" || t < c.start || t >= c.start + c.duration) continue;
        const local = t - c.start;
        const src = options.getBrollFrame(c, local);
        if (!src) continue;
        const card = drawBroll(ctx, src, c, local, width, height, u, safe, vertical);
        if (card) busy.push(card);
        else brollCover = true;
      }
    }

  // Tratamento visual do vídeo (e do b-roll): camadas de cor da grade, vinheta dinâmica e flash de impacto.
  // Fica por baixo dos componentes e das legendas: texto e cartões mantêm as cores do Brand Kit.
  if (frame || brollCover) {
    drawLookLayers(ctx, look, width, height);
    drawVignette(ctx, width, height, look.vignette, sceneEnergy(project, clip, t), t);
  }
  const impact = impactAt(project, t);
  if (impact.flash > 0.004) {
    ctx.save();
    ctx.globalAlpha = impact.flash;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  const duration = projectDuration(project);
  drawLetterbox(ctx, width, height, look.letterbox, t, duration);

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
      const hasPerson = def.needsPerson ? options.assumePerson === true || personLayer() !== null : false;
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
        subject,
        safe,
        vertical,
        hasPerson,
        // Guardrail do texto em profundidade: em close-up (ou sem recorte) vira cartão fora do rosto.
        depth: depthPlacement(subject, hasPerson, safeFrac, width / height),
        backdropBlur: (x, y, w, h, r = 0, blur = 18 * u) => {
          const m = ctx.getTransform();
          // Só translação/escala uniformes chegam aqui; o desfoque é aplicado em pixels do quadro.
          backdropBlur(ctx, m.a * x + m.e, m.d * y + m.f, w * m.a, h * m.d, r * m.a, blur);
        },
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

  // Legendas: somem (com fade) enquanto um card está na tela, desviam do texto dos outros componentes
  // e nunca ficam na frente do rosto.
  if (project.captions.enabled && !fullscreenOn) {
    const face = subject && frame && rect && !brollCover ? faceOnScreen(project, subject, rect, frame) : null;
    drawCaptions(ctx, project, t, u, safe, { onCaption: options.onCaption, editCaptionId: options.editCaptionId, busy, face, letterbox: letterboxHeight(look.letterbox, height, t, duration) });
  }
  if (options.guides) drawGuides(ctx, width, height, safe, u);
  ctx.restore();
}

/**
 * Caixa do rosto em pixels da TELA: `subject` está no enquadramento de base
 * (sem zoom); a câmera atual (`rect`) leva para onde o rosto realmente aparece.
 */
function faceOnScreen(project: Project, subject: NonNullable<ReturnType<typeof subjectAt>>, rect: Rect, frame: FrameSource): Rect {
  const { width: W, height: H } = project;
  const f = faceBox(subject, W / H);
  const s0 = Math.max(W / frame.width, H / frame.height);
  const w0 = frame.width * s0;
  const h0 = frame.height * s0;
  const x0 = (W - w0) * project.framing.x;
  const y0 = (H - h0) * project.framing.y;
  const sx = rect.w / w0;
  const sy = rect.h / h0;
  return { x: rect.x + (f.x * W - x0) * sx, y: rect.y + (f.y * H - y0) * sy, w: f.w * W * sx, h: f.h * H * sy };
}

/** Energia visual da cena em `t` (0–1): o movimento medido no vídeo de origem. Sem análise, 0. */
function sceneEnergy(project: Project, clip: MediaClip | null, t: number): number {
  const motion = clip ? project.assets[clip.assetId]?.analysis?.motion : undefined;
  if (!clip || !motion?.length) return 0;
  const src = sourceTimeAt(clip, t - clip.start);
  let best = motion[0]!;
  for (const m of motion) if (Math.abs(m.t - src) < Math.abs(best.t - src)) best = m;
  return best.v;
}

/**
 * Desenha a mídia de contexto preenchendo sua área (recorta o que sobra), com
 * um avanço lento para a imagem não ficar parada. Devolve a área do cartão,
 * quando é um, para as legendas desviarem.
 */
function drawBroll(ctx: Ctx2D, src: FrameSource, clip: BrollClip, local: number, W: number, H: number, u: number, safe: SafeArea, vertical: boolean): Rect | null {
  const edge = Math.min(0.2, clip.duration / 4);
  const alpha = clamp01(Math.min(local / edge, (clip.duration - local) / edge));
  const push = 1 + 0.05 * clamp01(local / clip.duration);
  const cover = (x: number, y: number, w: number, h: number) => {
    const s = Math.max(w / src.width, h / src.height) * push;
    const dw = src.width * s;
    const dh = src.height * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src.image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  };
  ctx.save();
  if (clip.layout === "full") {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    cover(0, 0, W, H);
    ctx.restore();
    return null;
  }
  // Cartão: no vertical ocupa a parte de cima; no horizontal, o lado direito.
  const w = vertical ? W - safe.left * 2 : W * 0.42;
  const h = vertical ? Math.min(H * 0.34, (w * 3) / 4) : (w * 9) / 16;
  const x = vertical ? safe.left : W - safe.right - w;
  const y = vertical ? safe.top : (H - h) / 2;
  const e = EASE.snap(stage(local, 0, 0.45));
  ctx.globalAlpha = Math.min(alpha * 1.4, 1) * clamp01(e * 1.6);
  ctx.translate(0, -40 * u * (1 - e));
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 14 * u;
  ctx.fillStyle = "#000";
  roundRect(ctx, x, y, w, h, 28 * u);
  ctx.fill();
  ctx.shadowColor = "transparent";
  roundRect(ctx, x, y, w, h, 28 * u);
  ctx.clip();
  cover(x, y, w, h);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = alpha * 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2 * u;
  roundRect(ctx, x, y, w, h, 28 * u);
  ctx.stroke();
  ctx.restore();
  return { x, y, w, h };
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
