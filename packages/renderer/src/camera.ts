import { clipsAt, type Project } from "@videoeditor/core";
import { clamp01, type Ctx2D, EASE, setBlur, supportsFilter } from "./draw";

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

  const zooms = clipsAt(project, t, "zoom");
  const z = zooms[zooms.length - 1];
  if (!z) return { x: x0, y: y0, w: w0, h: h0 };

  const local = t - z.start;
  const k =
    z.mode === "creep"
      ? EASE.glide(local / z.duration)
      : z.ease > 0
        ? Math.min(EASE.swift(local / z.ease), EASE.swift((z.duration - local) / z.ease))
        : 1;
  const scale = 1 + (z.scale - 1) * k;
  const fx = z.x * W;
  const fy = z.y * H;
  const w = w0 * scale;
  const h = h0 * scale;
  const clampTo = (v: number, size: number, frame: number) => Math.min(0, Math.max(frame - size, v));
  return {
    x: clampTo(fx - (fx - x0) * scale + z.panX * W * k, w, W),
    y: clampTo(fy - (fy - y0) * scale + z.panY * H * k, h, H),
    w,
    h,
  };
}

/** Quanto a câmera andou desde o quadro anterior, em pixels (maior deslocamento de borda). */
export function cameraSpeed(a: Rect, b: Rect): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));
}

/**
 * Desenha o vídeo pela câmera. Nos quadros em que ela se move rápido aplica
 * motion blur: ctx.filter onde existe; senão, três amostras entre a posição
 * anterior e a atual, sobrepostas com opacidade (rastro).
 */
export function drawVideo(ctx: Ctx2D, image: CanvasImageSource, rect: Rect, prev: Rect, u: number) {
  const speed = cameraSpeed(rect, prev);
  ctx.imageSmoothingQuality = "high";
  // Abaixo disso é movimento lento (creep) ou câmera parada: imagem nítida.
  if (speed < 7 * u) {
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  ctx.save();
  if (supportsFilter(ctx)) {
    const blur = Math.min(speed * 0.2, 14 * u);
    setBlur(ctx, blur);
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
