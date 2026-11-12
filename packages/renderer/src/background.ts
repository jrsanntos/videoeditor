import type { BrandKit } from "@videoeditor/core";
import { type Ctx2D, rgba } from "./draw";

/**
 * Fundo das cenas de tela cheia: a cor de fundo do Brand Kit com linhas
 * topográficas (curvas de nível) que se deformam devagar. `alpha` faz o fundo
 * entrar e sair por cima do vídeo.
 */
export function drawTopoBackground(ctx: Ctx2D, width: number, height: number, t: number, brand: BrandKit, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = brand.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const size = Math.max(width, height);
  ctx.lineWidth = Math.max(1, size / 900);
  // Dois "morros": um em cada canto oposto, com anéis que respiram.
  const hills = [
    { cx: width * 0.18, cy: height * 0.22, phase: 0, color: brand.textColor },
    { cx: width * 0.86, cy: height * 0.8, phase: 2.1, color: brand.primaryColor },
  ];
  for (const hill of hills) {
    for (let ring = 1; ring <= 11; ring++) {
      const r = (size * 0.075 * ring) / 1;
      ctx.strokeStyle = rgba(hill.color, 0.1 - ring * 0.006);
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const wobble =
          1 +
          0.11 * Math.sin(3 * a + ring * 0.7 + hill.phase + t * 0.22) +
          0.06 * Math.sin(5 * a - ring * 0.4 - t * 0.15 + hill.phase) +
          0.03 * Math.sin(9 * a + t * 0.3);
        const x = hill.cx + Math.cos(a) * r * wobble;
        const y = hill.cy + Math.sin(a) * r * wobble * 0.82;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Vinheta: escurece as bordas e concentra o olhar no texto.
  const g = ctx.createRadialGradient(width / 2, height / 2, size * 0.2, width / 2, height / 2, size * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * Marca d'água do plano Free, desenhada por cima do quadro exportado: discreta
 * o bastante para o vídeo ser avaliado, visível o bastante para não ser publicado.
 */
export function drawWatermark(ctx: Ctx2D, width: number, height: number, text = "feito com videoeditor") {
  const u = Math.min(width, height) / 1080;
  ctx.save();
  ctx.font = `700 ${Math.round(34 * u)}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 44 * u;
  const h = 62 * u;
  // Dentro da área útil do vertical (longe da interface do app), no terço superior.
  const cx = width / 2;
  const cy = height * 0.19;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(text, cx, cy + 2 * u);
  ctx.restore();
}
