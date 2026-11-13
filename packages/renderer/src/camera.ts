import { clipsAt, jumpsBefore, mainClipAt, subjectAt, subjectFocus, type Project, type ZoomClip } from "@videoeditor/core";
import { clamp01, type Ctx2D, EASE, easeOutCubic, spring, supportsFilter } from "./draw";

/** Onde o quadro de origem é desenhado no canvas do projeto. */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Câmera virtual: função pura de (projeto, tempo, tamanho da origem) → retângulo.
 * 1. Enquadramento base: o vídeo PREENCHE o quadro (recorta o que sobra), com
 *    o ponto de interesse dado por `project.framing` — é o que permite pôr um
 *    vídeo horizontal num projeto vertical.
 * 2. Zoom em torno do ponto focal + pan, com a intensidade vinda da curva do clip.
 * O resultado é preso às bordas: nunca aparece faixa preta.
 */
export function cameraAt(project: Project, t: number, srcW: number, srcH: number): Rect {
  const { width: W, height: H } = project;
  const s0 = Math.max(W / srcW, H / srcH);
  const w0 = srcW * s0;
  const h0 = srcH * s0;
  const x0 = (W - w0) * project.framing.x;
  const y0 = (H - h0) * project.framing.y;

  const clampTo = (v: number, size: number, frame: number) => Math.min(0, Math.max(frame - size, v));
  const rectFor = (scale: number, fxN: number, fyN: number, panX = 0, panY = 0): Rect => {
    const fx = fxN * W;
    const fy = fyN * H;
    const w = w0 * scale;
    const h = h0 * scale;
    return { x: clampTo(fx - (fx - x0) * scale + panX, w, W), y: clampTo(fy - (fy - y0) * scale + panY, h, H), w, h };
  };

  // Disfarce de corte: a cada corte real da fala o enquadramento alterna entre
  // aberto e levemente fechado no rosto, como uma troca de câmera.
  let base = 1;
  let bx = 0.5;
  let by = 0.38;
  if (project.finish?.cutZoom) {
    const clip = mainClipAt(project, t);
    if (clip && jumpsBefore(project, clip.id) % 2 === 1) base = CUT_ZOOM;
    const face = subjectAt(project, t);
    if (face) {
      bx = face.faceX;
      by = face.faceY;
    }
  }

  const zooms = clipsAt(project, t, "zoom");
  const z = zooms[zooms.length - 1];
  if (!z) return rectFor(base, bx, by);

  const k = zoomProgress(z, t - z.start);
  // Rastreamento: o foco segue o centro de massa do sujeito, quadro a quadro, em vez de mirar um ponto fixo.
  let zx = z.x;
  let zy = z.y;
  if (z.follow) {
    const s = subjectAt(project, t);
    if (s) ({ x: zx, y: zy } = subjectFocus(s));
  }
  // O zoom parte do enquadramento de base (e volta a ele), sem salto no meio da fala.
  const scale = Math.max(1, base + (Math.max(z.scale, base) - base) * k);
  const kc = clamp01(k);
  return shake(rectFor(scale, bx + (zx - bx) * kc, by + (zy - by) * kc, z.panX * W * kc, z.panY * H * kc), project, t);

  /** Tremida de impacto: desloca o quadro e fecha um pouco para a borda nunca aparecer. */
  function shake(rect: Rect, p: Project, time: number): Rect {
    const imp = impactAt(p, time);
    if (!imp.shake) return rect;
    const grow = 1 + 0.035 * imp.shake;
    const cx = rect.x + rect.w / 2 + imp.dx * W;
    const cy = rect.y + rect.h / 2 + imp.dy * H;
    const w = rect.w * grow;
    const h = rect.h * grow;
    return { x: clampTo(cx - w / 2, w, W), y: clampTo(cy - h / 2, h, H), w, h };
  }
}

/** Intensidade 0–1 (a mola pode passar um pouco de 1) do zoom em `local` segundos desde o início dele. */
export function zoomProgress(z: Pick<ZoomClip, "mode" | "ease" | "duration" | "easing">, local: number): number {
  if (z.mode === "creep") return EASE.glide(local / z.duration);
  if (z.ease <= 0) return 1;
  const curve = z.easing === "spring" ? (x: number) => spring(x, { damping: 0.5, frequency: 1.6 }) : z.easing === "ease_out" ? easeOutCubic : EASE.swift;
  // A saída é sempre sem overshoot: mola na volta pareceria um tranco.
  const out = (z.easing === "spring" ? easeOutCubic : curve)((z.duration - local) / z.ease);
  return local < z.duration / 2 ? Math.min(curve(local / z.ease), 1.12) : out;
}

/**
 * Impacto de câmera em `t`: flash (opacidade do branco, 0–1) e tremida
 * (deslocamento em fração do quadro), decaindo ao longo do clip. Determinístico.
 */
export function impactAt(project: Project, t: number): { flash: number; shake: number; dx: number; dy: number } {
  let flash = 0;
  let shakeK = 0;
  let dx = 0;
  let dy = 0;
  for (const c of clipsAt(project, t, "impact")) {
    const local = t - c.start;
    const decay = Math.pow(1 - clamp01(local / c.duration), 2);
    if (c.kind !== "shake") flash = Math.max(flash, clamp01(0.85 * c.intensity * Math.pow(1 - clamp01(local / Math.min(0.22, c.duration)), 2)));
    if (c.kind !== "flash") {
      const k = decay * c.intensity;
      shakeK = Math.max(shakeK, clamp01(k));
      // Duas senoides de frequências primas entre si: parece câmera na mão levando um tranco, sem ruído aleatório.
      dx += 0.012 * k * Math.sin(local * 61) * Math.cos(local * 23);
      dy += 0.016 * k * Math.sin(local * 47 + 1.3);
    }
  }
  return { flash, shake: shakeK, dx, dy };
}

/** Aproximação usada para disfarçar cortes: perceptível como troca de plano, sem perder nitidez. */
export const CUT_ZOOM = 1.08;

/** Quanto a câmera andou desde o quadro anterior, em pixels (maior deslocamento de borda). */
export function cameraSpeed(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));
}

/**
 * Desenha o vídeo pela câmera. Nos quadros em que ela se move rápido aplica
 * motion blur: ctx.filter onde existe; senão, três amostras entre a posição
 * anterior e a atual, sobrepostas com opacidade (rastro).
 */
export function drawVideo(ctx: Ctx2D, image: CanvasImageSource, rect: Rect, prev: Rect, u: number, grade = "none") {
  const speed = cameraSpeed(rect, prev);
  const graded = grade !== "none" && supportsFilter(ctx);
  ctx.imageSmoothingQuality = "high";
  // Abaixo disso é movimento lento (creep) ou câmera parada: imagem nítida.
  if (speed < 7 * u) {
    if (graded) {
      ctx.save();
      ctx.filter = grade;
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    } else ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  ctx.save();
  if (supportsFilter(ctx)) {
    const blur = Math.min(speed * 0.2, 14 * u);
    // Tratamento de cor e motion blur no mesmo desenho.
    ctx.filter = `${graded ? `${grade} ` : ""}${blur >= 0.5 ? `blur(${blur.toFixed(1)}px)` : ""}`.trim() || "none";
    // O desfoque clareia as bordas; desenhar um pouco maior esconde isso.
    const pad = blur * 2;
    ctx.drawImage(image, rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
  } else {
    const samples = 3;
    for (let i = 0; i < samples; i++) {
      const m = clamp01(i / (samples - 1));
      ctx.globalAlpha = 1 / (i + 1);
      ctx.drawImage(
        image,
        prev.x + (rect.x - prev.x) * m,
        prev.y + (rect.y - prev.y) * m,
        prev.w + (rect.w - prev.w) * m,
        prev.h + (rect.h - prev.h) * m,
      );
    }
  }
  ctx.restore();
}
