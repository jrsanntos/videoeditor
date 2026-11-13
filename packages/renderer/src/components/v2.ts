import { z } from "zod";
import { MotionGraphicSchema, subjectFocus, type BrandKit, type MgAnim, type MgColor, type MgNode } from "@videoeditor/core";
import { clamp01, cubicBezier, type Ctx2D, EASE, easeInOutCubic, easeOutBack, easeOutCubic, enter, font, formatNumber, getUnit, rgba, roundRect, serifFont, spring, stage, wrapText } from "../draw";
import { drawRich, fitRich, layoutRich, type RichLayout } from "../text";
import type { ComponentDef, DrawArgs } from "./library";

/**
 * Componentes da v2: cards de dados, comparativo, HUD tático, prova social,
 * callout e indicador de etapas — mais o motor declarativo
 * `custom_motion_graphic`, que desenha árvores geradas pelo Diretor de IA.
 * Todos herdam o Brand Kit, respeitam as áreas seguras e usam física de mola
 * nas entradas.
 */
const define = <S extends z.ZodType>(def: ComponentDef<S>) => def;
const rich = (max: number, what: string) => z.string().min(1).max(max).describe(`${what}. Marque 1–2 palavras de ênfase com *asteriscos*`);
const at = z.number().min(0).optional().describe("instante de entrada, em segundos desde o início do componente; mande atWord com o id da palavra");
const fadeOut = (t: number, duration: number, d = 0.3) => clamp01((duration - t) / d);
const pop = (x: number) => spring(x, { damping: 0.5, frequency: 1.5 });
const INK = "#0b0b10";

// ---------------------------------------------------------------- stat_counter_card

const countTime = (duration: number) => Math.min(1.5, duration * 0.45);

const statCounterCard = define({
  id: "stat_counter_card",
  name: "Cartão de número",
  description:
    "Cartão de dado: contador numérico animado com prefixo/sufixo, legenda e barra de progresso. Fica por cima do vídeo, fora do rosto. Use em todo número relevante da fala (resultado, porcentagem, prazo, valor).",
  defaultDuration: 4,
  schema: z.object({
    value: z.number().describe("valor final"),
    from: z.number().default(0),
    prefix: z.string().max(6).default("").describe('ex.: "R$ ", "+"'),
    suffix: z.string().max(8).default("").describe('ex.: "%", " mil", "x"'),
    decimals: z.number().int().min(0).max(2).default(0),
    label: rich(56, "o que o número significa"),
    progress: z.number().min(0).max(1).optional().describe("quanto a barra enche (0–1). Omitido: value/100 quando o sufixo é %, senão a barra enche inteira"),
    position: z.enum(["bottom", "top"]).default("bottom"),
  }),
  example: { value: 73, suffix: "%", label: "dos clientes *voltam* em 30 dias" },
  labels: { value: "Valor final", from: "Começa em", prefix: "Antes do número", suffix: "Depois do número", decimals: "Casas decimais", label: "Legenda", progress: "Barra (0 a 1)", position: "Posição" },
  sounds: (params, duration) => [
    { at: 0.05, sfx: "swoosh_texto" as const },
    ...Array.from({ length: Math.min(7, Math.floor(countTime(duration) / 0.16)) }, (_, i) => ({ at: 0.3 + i * 0.16, sfx: "tecla" as const })),
    { at: 0.25 + countTime(duration), sfx: /\$/.test(params.prefix) ? ("caixa_registradora" as const) : ("pop" as const) },
  ],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region, backdropBlur }) {
    const out = fadeOut(t, duration);
    const k = EASE.snap(stage(t, 0.25, countTime(duration)));
    const finalText = `${params.prefix}${formatNumber(params.value, params.decimals)}${params.suffix}`;
    const text = `${params.prefix}${formatNumber(params.from + (params.value - params.from) * k, params.decimals)}${params.suffix}`;
    const cardW = Math.min((W - safe.left - safe.right) * (vertical ? 0.9 : 0.42), 860 * u);
    const pad = 40 * u;
    let size = 150 * u;
    ctx.font = font(900, size);
    const nw = ctx.measureText(finalText).width;
    if (nw > cardW - pad * 2) size *= (cardW - pad * 2) / nw;
    const label = fitRich(ctx, params.label, { size: 40 * u, weight: 600, color: brand.textColor, emphColor: brand.primaryColor }, cardW - pad * 2, 2);
    const barH = 12 * u;
    const cardH = pad + size + 14 * u + label.height + 26 * u + barH + pad;
    const x = vertical ? safe.left + (W - safe.left - safe.right - cardW) / 2 : W - safe.right - cardW;
    const y = params.position === "top" ? safe.top + 10 * u : H - safe.bottom - cardH - (vertical ? 150 * u : 40 * u);
    const e = pop(stage(t, 0, 0.55));

    ctx.save();
    ctx.globalAlpha = out * clamp01(e * 1.8);
    ctx.translate(x + cardW / 2, y + cardH / 2);
    ctx.scale(0.9 + 0.1 * e, 0.9 + 0.1 * e);
    ctx.translate(-cardW / 2, -cardH / 2 + 50 * u * (1 - Math.min(e, 1)));
    backdropBlur(0, 0, cardW, cardH, 30 * u);
    ctx.fillStyle = rgba(brand.backgroundColor, 0.78);
    roundRect(ctx, 0, 0, cardW, cardH, 30 * u);
    ctx.fill();
    ctx.strokeStyle = rgba(brand.textColor, 0.14);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    region("", 0, 0, cardW, cardH);
    ctx.font = font(900, size);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = brand.primaryColor;
    ctx.fillText(text, pad, pad + size * 0.82);
    drawRich(ctx, label, pad, pad + size + 14 * u);
    region("label", pad, pad + size + 14 * u, label.width, label.height);
    // Barra de progresso: enche junto com o contador.
    const target = params.progress ?? (params.suffix.trim() === "%" ? clamp01(Math.abs(params.value) / 100) : 1);
    const by = cardH - pad - barH;
    ctx.fillStyle = rgba(brand.textColor, 0.16);
    roundRect(ctx, pad, by, cardW - pad * 2, barH, barH / 2);
    ctx.fill();
    ctx.fillStyle = brand.primaryColor;
    roundRect(ctx, pad, by, Math.max(barH, (cardW - pad * 2) * target * k), barH, barH / 2);
    ctx.fill();
    ctx.restore();
  },
});

// ---------------------------------------------------------------- comparison_split

const comparisonSplit = define({
  id: "comparison_split",
  name: "Comparativo",
  description:
    "Comparativo animado em duas metades: Antes vs. Depois, Prós vs. Contras, Mito vs. Verdade. O lado A entra primeiro; o lado B entra em `revealAt` (quando a fala vira) e ganha o destaque. Marcadores (`marks`): 'contrast' põe ✕ no lado A e ✓ no B (A é o errado/antes/mito); 'reversed' põe ✓ no A e ✕ no B (B é o proibido/contra/errado); 'neutral' usa pontos nos dois (dois tipos ou duas opções, sem certo e errado). Escolha pelo SENTIDO: um ✓ num item proibido é desinformação. Cena de tela cheia: use uma vez, numa virada de raciocínio.",
  defaultDuration: 6,
  schema: z.object({
    leftTitle: z.string().min(1).max(18).default("Antes"),
    rightTitle: z.string().min(1).max(18).default("Depois"),
    left: z.array(z.string().min(1).max(42)).min(1).max(3).describe("pontos do lado A, curtos"),
    right: z.array(z.string().min(1).max(42)).min(1).max(3).describe("pontos do lado B, curtos"),
    revealAt: at,
    marks: z.enum(["contrast", "reversed", "neutral"]).default("contrast").describe("contrast: ✕ no A, ✓ no B. reversed: ✓ no A, ✕ no B. neutral: pontos nos dois"),
    fullscreen: z.boolean().default(true),
  }),
  example: { leftTitle: "Antes", rightTitle: "Depois", left: ["3 horas editando", "Vídeo parado"], right: ["10 minutos", "Ritmo de profissional"], revealAt: 2.4, marks: "contrast" },
  labels: { leftTitle: "Título do lado A", rightTitle: "Título do lado B", left: "Pontos do lado A", right: "Pontos do lado B", revealAt: "Quando o lado B entra (s)", marks: "Marcadores", fullscreen: "Tela cheia" },
  sounds: (params, duration) => {
    const reveal = params.revealAt ?? Math.min(duration * 0.42, 2.6);
    return [{ at: 0.05, sfx: "swoosh_texto" as const }, { at: reveal, sfx: "whoosh_rapido" as const }, ...params.right.map((_, i) => ({ at: reveal + 0.35 + i * 0.3, sfx: i === 0 ? ("pop" as const) : ("click_suave" as const) }))];
  },
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region }) {
    const out = fadeOut(t, duration);
    const reveal = params.revealAt ?? Math.min(duration * 0.42, 2.6);
    const inK = EASE.snap(stage(t, 0, 0.45));
    const rv = EASE.snap(stage(t, reveal, 0.55));
    ctx.save();
    ctx.globalAlpha = out * inK * (params.fullscreen ? 1 : 0.94);
    ctx.fillStyle = brand.backgroundColor;
    const area = params.fullscreen ? { x: 0, y: 0, w: W, h: H } : { x: safe.left, y: H * 0.28, w: W - safe.left - safe.right, h: H * 0.44 };
    if (params.fullscreen) ctx.fillRect(0, 0, W, H);
    else {
      roundRect(ctx, area.x, area.y, area.w, area.h, 30 * u);
      ctx.fill();
      region("", area.x, area.y, area.w, area.h);
    }
    // No vertical as metades ficam empilhadas; no horizontal, lado a lado.
    const stacked = vertical;
    const inner = { x: Math.max(area.x, safe.left) + 30 * u, y: Math.max(area.y, params.fullscreen ? safe.top : area.y) + 30 * u, w: 0, h: 0 };
    inner.w = Math.min(area.x + area.w, W - (params.fullscreen ? safe.right : 0)) - inner.x - 30 * u;
    inner.h = Math.min(area.y + area.h, H - (params.fullscreen ? safe.bottom : 0)) - inner.y - 30 * u;
    const half = stacked ? { w: inner.w, h: inner.h / 2 } : { w: inner.w / 2, h: inner.h };
    const side = (index: 0 | 1, title: string, items: string[], k: number, strong: boolean) => {
      const x = inner.x + (stacked ? 0 : index * half.w);
      const y = inner.y + (stacked ? index * half.h : 0);
      const color = index === 1 ? brand.primaryColor : rgba(brand.textColor, 0.55);
      ctx.save();
      ctx.globalAlpha *= clamp01(k * 1.6) * (strong ? 1 : 0.42);
      ctx.translate((stacked ? 0 : index ? 60 : -60) * u * (1 - k), (stacked ? (index ? 60 : -60) : 0) * u * (1 - k));
      const px = x + 26 * u;
      let cy = y + (stacked ? 34 * u : half.h * 0.2);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = color;
      ctx.font = font(900, 34 * u);
      const tag = title.toUpperCase();
      const tw = ctx.measureText(tag).width + 36 * u;
      roundRect(ctx, px, cy, tw, 58 * u, 29 * u);
      ctx.fill();
      ctx.fillStyle = index === 1 ? INK : brand.backgroundColor;
      ctx.textBaseline = "middle";
      ctx.fillText(tag, px + 18 * u, cy + 30 * u);
      region(index ? "rightTitle" : "leftTitle", px, cy, tw, 58 * u);
      cy += 58 * u + 30 * u;
      items.forEach((item, i) => {
        const ik = index === 1 ? pop(stage(t, reveal + 0.3 + i * 0.3, 0.45)) : EASE.snap(stage(t, 0.25 + i * 0.22, 0.45));
        const layout = fitRich(ctx, item, { size: (vertical ? 62 : 54) * u, weight: 800, color: brand.textColor, emphColor: brand.primaryColor }, half.w - 90 * u, 2, 30 * u);
        ctx.save();
        ctx.globalAlpha *= clamp01(ik * 1.5);
        ctx.translate(24 * u * (1 - Math.min(ik, 1)), 0);
        // Marcador: ✕ discreto no lado A, ✓ na cor de destaque no lado B.
        ctx.strokeStyle = color;
        ctx.lineWidth = 7 * u;
        ctx.lineCap = "round";
        const mx = px + 16 * u;
        const my = cy + layout.style.size * 0.55;
        // O marcador segue o sentido de cada lado, não a posição: "proibido" nunca leva ✓.
        const mark = params.marks === "neutral" ? "dot" : (index === 1) === (params.marks !== "reversed") ? "check" : "cross";
        ctx.beginPath();
        if (mark === "check") {
          ctx.moveTo(mx - 14 * u, my);
          ctx.lineTo(mx - 3 * u, my + 12 * u);
          ctx.lineTo(mx + 16 * u, my - 14 * u);
          ctx.stroke();
        } else if (mark === "cross") {
          ctx.moveTo(mx - 12 * u, my - 12 * u);
          ctx.lineTo(mx + 12 * u, my + 12 * u);
          ctx.moveTo(mx + 12 * u, my - 12 * u);
          ctx.lineTo(mx - 12 * u, my + 12 * u);
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.arc(mx, my, 8 * u, 0, Math.PI * 2);
          ctx.fill();
        }
        drawRich(ctx, layout, px + 54 * u, cy);
        region(`${index ? "right" : "left"}.${i}`, px + 54 * u, cy, layout.width, layout.height);
        ctx.restore();
        cy += layout.height + 22 * u;
      });
      ctx.restore();
    };
    // O lado A perde o destaque quando o B entra.
    side(0, params.leftTitle, params.left, inK, rv < 0.5);
    side(1, params.rightTitle, params.right, rv, true);
    // Divisória que se desenha do centro para as pontas.
    ctx.globalAlpha = out * inK;
    ctx.fillStyle = rgba(brand.textColor, 0.22);
    const dk = EASE.snap(stage(t, 0.15, 0.6));
    if (stacked) ctx.fillRect(inner.x + (inner.w * (1 - dk)) / 2, inner.y + half.h - 1.5 * u, inner.w * dk, 3 * u);
    else ctx.fillRect(inner.x + half.w - 1.5 * u, inner.y + (inner.h * (1 - dk)) / 2, 3 * u, inner.h * dk);
    ctx.restore();
  },
});

// ---------------------------------------------------------------- tactical_hud_overlay

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, "0");

const tacticalHud = define({
  id: "tactical_hud_overlay",
  name: "HUD tático",
  description:
    "Overlay de telemetria para vídeos de ação e operação: cantoneiras, indicador de status piscando, timestamp correndo, linhas de telemetria e um retículo que acompanha o sujeito. Não cobre a cena. Use em trechos de ação (4–8 s), não o vídeo inteiro.",
  defaultDuration: 6,
  schema: z.object({
    label: z.string().min(1).max(22).default("OPERAÇÃO").describe("rótulo no canto superior esquerdo, em caixa alta"),
    status: z.string().min(1).max(16).default("REC").describe("indicador de status ao lado do ponto piscando: REC, AO VIVO, ALVO, TREINO"),
    telemetry: z.array(z.object({ k: z.string().min(1).max(10), v: z.string().min(1).max(14) })).max(4).default([]).describe('pares curtos, ex.: {k:"DIST", v:"25 m"}'),
    timestamp: z.boolean().default(true).describe("mostra o timecode correndo"),
    reticle: z.boolean().default(true).describe("retículo sobre o sujeito detectado"),
  }),
  example: { label: "TREINO TÁTICO", status: "REC", telemetry: [{ k: "DIST", v: "25 m" }, { k: "ALVOS", v: "03" }], timestamp: true, reticle: true },
  labels: { label: "Rótulo", status: "Status", telemetry: "Telemetria", timestamp: "Timecode", reticle: "Retículo no sujeito" },
  sounds: () => [{ at: 0.05, sfx: "glitch" as const }, { at: 0.5, sfx: "ping" as const }],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, subject, region }) {
    const out = fadeOut(t, duration, 0.25);
    const e = EASE.snap(stage(t, 0, 0.5));
    // Liga com um tremor curto, como um visor ganhando sinal.
    const flicker = t < 0.35 ? (Math.sin(t * 90) > 0 ? 1 : 0.35) : 1;
    const c = brand.primaryColor;
    const x0 = safe.left;
    const y0 = safe.top;
    const x1 = W - safe.right;
    const y1 = H - safe.bottom;
    ctx.save();
    ctx.globalAlpha = out * flicker * clamp01(e * 2);
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 4 * u;
    ctx.lineCap = "square";
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 6 * u;
    // Cantoneiras que se abrem do centro para os cantos.
    const L = 64 * u * e;
    const inset = 40 * u * (1 - e);
    const corner = (cx: number, cy: number, sx: number, sy: number) => {
      ctx.beginPath();
      ctx.moveTo(cx + sx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * L);
      ctx.stroke();
    };
    corner(x0 + inset, y0 + inset, 1, 1);
    corner(x1 - inset, y0 + inset, -1, 1);
    corner(x0 + inset, y1 - inset, 1, -1);
    corner(x1 - inset, y1 - inset, -1, -1);

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const mono = (px: number) => `700 ${Math.round(px)}px "Space Grotesk", "Inter", ui-monospace, monospace`;
    // Status: ponto piscando + rótulo.
    const ty = y0 + 46 * u;
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.beginPath();
      ctx.arc(x0 + 34 * u, ty, 9 * u, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = mono(30 * u);
    ctx.fillText(params.status.toUpperCase(), x0 + 54 * u, ty);
    const sw = ctx.measureText(params.status.toUpperCase()).width;
    ctx.fillStyle = c;
    ctx.fillText(`/ ${params.label.toUpperCase()}`, x0 + 54 * u + sw + 14 * u, ty);
    region("label", x0 + 54 * u + sw + 14 * u, ty - 18 * u, ctx.measureText(`/ ${params.label.toUpperCase()}`).width, 36 * u);
    if (params.timestamp) {
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff";
      const frames = Math.floor((t % 1) * 30);
      ctx.fillText(`${pad2(t / 60)}:${pad2(t % 60)}:${pad2(frames)}`, x1 - 30 * u, ty);
    }
    // Telemetria: uma linha por vez, digitada.
    ctx.textAlign = "left";
    params.telemetry.forEach((row, i) => {
      const k = stage(t, 0.4 + i * 0.25, 0.4);
      if (k <= 0) return;
      const y = y1 - 46 * u - (params.telemetry.length - 1 - i) * 44 * u;
      ctx.font = mono(26 * u);
      ctx.fillStyle = rgba("#ffffff", 0.7);
      ctx.fillText(row.k.toUpperCase(), x0 + 30 * u, y);
      ctx.fillStyle = "#fff";
      const shown = row.v.slice(0, Math.ceil(row.v.length * k));
      ctx.fillText(shown, x0 + 30 * u + 150 * u, y);
      region(`telemetry.${i}.v`, x0 + 30 * u + 150 * u, y - 16 * u, ctx.measureText(row.v).width, 32 * u);
    });
    // Linha de varredura lenta.
    ctx.globalAlpha *= 0.22;
    const sy = y0 + ((t * 0.18) % 1) * (y1 - y0);
    ctx.fillRect(x0, sy, x1 - x0, 2 * u);
    ctx.globalAlpha = out * flicker * clamp01(e * 2);
    // Retículo: trava no centro de massa do sujeito e aperta ao travar.
    if (params.reticle) {
      const f = subject ? subjectFocus(subject) : { x: 0.5, y: 0.45 };
      const cx = f.x * W;
      const cy = f.y * H;
      const lock = EASE.snap(stage(t, 0.5, 0.7));
      const r = (150 - 60 * lock) * u;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = c;
      for (let i = 0; i < 4; i++) {
        const a0 = (i * Math.PI) / 2 + t * 0.5 + 0.25;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + Math.PI / 4);
        ctx.stroke();
      }
      const tick = 16 * u;
      ctx.beginPath();
      ctx.moveTo(cx - r - tick, cy);
      ctx.lineTo(cx - r * 0.55, cy);
      ctx.moveTo(cx + r * 0.55, cy);
      ctx.lineTo(cx + r + tick, cy);
      ctx.moveTo(cx, cy - r - tick);
      ctx.lineTo(cx, cy - r * 0.55);
      ctx.moveTo(cx, cy + r * 0.55);
      ctx.lineTo(cx, cy + r + tick);
      ctx.stroke();
    }
    ctx.restore();
  },
});

// ---------------------------------------------------------------- social_proof_toast

const ICONS = ["check", "star", "heart", "bell", "user"] as const;
function drawIcon(ctx: Ctx2D, icon: (typeof ICONS)[number], cx: number, cy: number, r: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = r * 0.24;
  ctx.beginPath();
  if (icon === "check") {
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(-r * 0.12, r * 0.38);
    ctx.lineTo(r * 0.55, -r * 0.4);
    ctx.stroke();
  } else if (icon === "star") {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.3 : r * 0.68;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else if (icon === "heart") {
    ctx.moveTo(0, r * 0.55);
    ctx.bezierCurveTo(-r * 0.95, -r * 0.05, -r * 0.5, -r * 0.75, 0, -r * 0.25);
    ctx.bezierCurveTo(r * 0.5, -r * 0.75, r * 0.95, -r * 0.05, 0, r * 0.55);
    ctx.fill();
  } else if (icon === "bell") {
    ctx.moveTo(-r * 0.5, r * 0.3);
    ctx.quadraticCurveTo(-r * 0.45, -r * 0.6, 0, -r * 0.6);
    ctx.quadraticCurveTo(r * 0.45, -r * 0.6, r * 0.5, r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, r * 0.5, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.arc(0, -r * 0.22, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, r * 0.75, r * 0.6, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.restore();
}

const socialProofToast = define({
  id: "social_proof_toast",
  name: "Notificação de prova social",
  description:
    "Balão de notificação no estilo de interface moderna (ícone, título, mensagem e horário), que entra com física de mola no topo ou na base. Use para prova social: depoimento curto, venda, novo seguidor, resultado de cliente.",
  defaultDuration: 3.5,
  schema: z.object({
    title: z.string().min(1).max(32).describe("quem ou o quê: nome do cliente, do app, da métrica"),
    message: rich(70, "a prova em uma linha"),
    icon: z.enum(ICONS).default("check"),
    meta: z.string().max(14).default("agora").describe('horário ou selo curto: "agora", "há 2 min", "verificado"'),
    position: z.enum(["top", "bottom"]).default("top"),
  }),
  example: { title: "Marina, cliente", message: "Fechei *3 contratos* na primeira semana", icon: "star", meta: "há 2 min" },
  labels: { title: "Título", message: "Mensagem", icon: "Ícone", meta: "Horário / selo", position: "Posição" },
  sounds: () => [{ at: 0.08, sfx: "notificacao" as const }],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, vertical, region, backdropBlur }) {
    const out = fadeOut(t, duration, 0.25);
    const e = pop(stage(t, 0, 0.6));
    const w = Math.min(W - safe.left - safe.right, vertical ? 880 * u : 760 * u);
    const pad = 28 * u;
    const iconR = 44 * u;
    const textW = w - pad * 3 - iconR * 2;
    const msg = fitRich(ctx, params.message, { size: 38 * u, weight: 600, color: brand.textColor, emphColor: brand.primaryColor }, textW, 2, 26 * u);
    const h = Math.max(iconR * 2, 46 * u + msg.height) + pad * 2;
    // No vertical, centralizado; no horizontal o centro é onde fica o rosto, então a notificação vai para o canto direito.
    const x = vertical ? safe.left + (W - safe.left - safe.right - w) / 2 : W - safe.right - w;
    const top = params.position === "top";
    const y = top ? safe.top + 16 * u : H - safe.bottom - h - (vertical ? 170 * u : 30 * u);
    const from = (top ? -1 : 1) * (h + 80 * u);
    ctx.save();
    ctx.globalAlpha = out * clamp01(e * 2.2);
    // Sai deslizando de volta para a borda de onde veio.
    ctx.translate(0, from * (1 - e) + from * 0.5 * (1 - out));
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 40 * u;
    ctx.shadowOffsetY = 14 * u;
    ctx.fillStyle = rgba(brand.backgroundColor, 0.86);
    roundRect(ctx, x, y, w, h, 34 * u);
    ctx.fill();
    ctx.shadowColor = "transparent";
    backdropBlur(x, y, w, h, 34 * u, 14 * u);
    ctx.fillStyle = rgba(brand.backgroundColor, 0.72);
    roundRect(ctx, x, y, w, h, 34 * u);
    ctx.fill();
    ctx.strokeStyle = rgba(brand.textColor, 0.16);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    region("", x, y, w, h);
    // Ícone num círculo na cor de destaque, com um pequeno salto próprio.
    const ik = pop(stage(t, 0.18, 0.5));
    const icx = x + pad + iconR;
    const icy = y + h / 2;
    ctx.save();
    ctx.translate(icx, icy);
    ctx.scale(ik, ik);
    ctx.fillStyle = brand.primaryColor;
    ctx.beginPath();
    ctx.arc(0, 0, iconR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    drawIcon(ctx, params.icon, 0, 0, iconR);
    ctx.restore();
    const tx = icx + iconR + pad;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = font(800, 32 * u);
    ctx.fillStyle = brand.textColor;
    ctx.fillText(params.title, tx, y + pad);
    region("title", tx, y + pad, ctx.measureText(params.title).width, 36 * u);
    ctx.font = font(500, 24 * u);
    ctx.fillStyle = rgba(brand.textColor, 0.55);
    ctx.textAlign = "right";
    ctx.fillText(params.meta, x + w - pad, y + pad + 4 * u);
    drawRich(ctx, msg, tx, y + pad + 44 * u);
    region("message", tx, y + pad + 44 * u, msg.width, msg.height);
    ctx.restore();
  },
});

// ---------------------------------------------------------------- callout_pointer

const calloutPointer = define({
  id: "callout_pointer",
  name: "Callout com ponteiro",
  description:
    "Linha vetorial animada que parte de um rótulo e aponta para um detalhe da cena, com um ponto pulsando no alvo. Use para nomear um objeto, um gesto, um detalhe técnico. Sem `target`, aponta para o sujeito detectado.",
  defaultDuration: 3.5,
  schema: z.object({
    label: z.string().min(1).max(28).describe("o nome do detalhe, 1 a 3 palavras"),
    detail: z.string().max(44).optional().describe("linha de apoio menor"),
    target: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional().describe("ponto apontado, em frações do quadro. Omita para apontar o sujeito detectado"),
    side: z.enum(["auto", "left", "right"]).default("auto").describe("de que lado fica o rótulo"),
  }),
  example: { label: "Empunhadura", detail: "polegares alinhados", target: { x: 0.55, y: 0.5 } },
  labels: { label: "Rótulo", detail: "Linha de apoio", target: "Ponto apontado", side: "Lado do rótulo" },
  sounds: () => [{ at: 0.05, sfx: "swoosh_texto" as const }, { at: 0.55, sfx: "ping" as const }],
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, subject, region }) {
    const out = fadeOut(t, duration, 0.25);
    const focus = params.target ?? (subject ? subjectFocus(subject) : { x: 0.5, y: 0.45 });
    const tx = focus.x * W;
    const ty = focus.y * H;
    const right = params.side === "right" || (params.side === "auto" && focus.x < 0.5);
    ctx.font = font(800, 46 * u);
    const lw = ctx.measureText(params.label).width;
    ctx.font = font(500, 30 * u);
    const dw = params.detail ? ctx.measureText(params.detail).width : 0;
    const boxW = Math.max(lw, dw) + 48 * u;
    const boxH = (params.detail ? 118 : 78) * u;
    // O rótulo fica no lado com mais espaço, um pouco acima do alvo.
    const bx = right ? Math.min(W - safe.right - boxW, tx + 150 * u) : Math.max(safe.left, tx - 150 * u - boxW);
    const by = Math.min(H - safe.bottom - boxH, Math.max(safe.top, ty - 210 * u));
    const anchorX = right ? bx : bx + boxW;
    const anchorY = by + boxH;
    const elbowX = right ? Math.max(tx + 40 * u, anchorX - 60 * u) : Math.min(tx - 40 * u, anchorX + 60 * u);
    const line = easeInOutCubic(stage(t, 0.05, 0.5));
    ctx.save();
    ctx.globalAlpha = out;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8 * u;
    // Alvo: ponto + anel que pulsa.
    const dot = pop(stage(t, 0, 0.4));
    ctx.fillStyle = brand.primaryColor;
    ctx.beginPath();
    ctx.arc(tx, ty, 11 * u * dot, 0, Math.PI * 2);
    ctx.fill();
    const pulse = (t * 0.9) % 1;
    ctx.strokeStyle = rgba(brand.primaryColor, 0.9 * (1 - pulse));
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.arc(tx, ty, (16 + 34 * pulse) * u, 0, Math.PI * 2);
    ctx.stroke();
    // Linha em cotovelo, desenhada do alvo até o rótulo.
    const pts: [number, number][] = [[tx, ty], [elbowX, anchorY], [anchorX, anchorY]];
    const seg1 = Math.hypot(pts[1]![0] - tx, pts[1]![1] - ty);
    const seg2 = Math.abs(pts[2]![0] - pts[1]![0]);
    const drawn = (seg1 + seg2) * line;
    ctx.strokeStyle = brand.primaryColor;
    ctx.lineWidth = 4 * u;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    const k1 = Math.min(1, drawn / Math.max(seg1, 1));
    ctx.lineTo(tx + (pts[1]![0] - tx) * k1, ty + (pts[1]![1] - ty) * k1);
    if (drawn > seg1) ctx.lineTo(pts[1]![0] + (pts[2]![0] - pts[1]![0]) * Math.min(1, (drawn - seg1) / Math.max(seg2, 1)), anchorY);
    ctx.stroke();
    // Rótulo: entra quando a linha chega.
    const e = EASE.snap(stage(t, 0.45, 0.45));
    ctx.globalAlpha = out * clamp01(e * 1.6);
    ctx.translate((right ? -1 : 1) * 30 * u * (1 - e), 0);
    ctx.shadowBlur = 24 * u;
    ctx.fillStyle = rgba(brand.backgroundColor, 0.86);
    roundRect(ctx, bx, by, boxW, boxH, 16 * u);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = brand.primaryColor;
    ctx.fillRect(right ? bx : bx + boxW - 6 * u, by + 12 * u, 6 * u, boxH - 24 * u);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = brand.textColor;
    ctx.font = font(800, 46 * u);
    ctx.fillText(params.label, bx + 26 * u, by + 14 * u);
    region("label", bx + 26 * u, by + 14 * u, lw, 50 * u);
    if (params.detail) {
      ctx.fillStyle = rgba(brand.textColor, 0.72);
      ctx.font = font(500, 30 * u);
      ctx.fillText(params.detail, bx + 26 * u, by + 72 * u);
      region("detail", bx + 26 * u, by + 72 * u, dw, 34 * u);
    }
    region("", bx, by, boxW, boxH);
    ctx.restore();
  },
});

// ---------------------------------------------------------------- step_progress_bar

const stepProgressBar = define({
  id: "step_progress_bar",
  name: "Barra de etapas",
  description:
    "Indicador de etapas ou capítulos no topo (ou na lateral) do quadro: segmentos que enchem conforme a explicação avança, com o nome da etapa atual. Discreto, convive com a legenda. Cubra com ele o trecho inteiro em que as etapas são explicadas e sincronize cada etapa com atWord.",
  defaultDuration: 12,
  schema: z.object({
    steps: z.array(z.object({ label: z.string().min(1).max(24), at })).min(2).max(6),
    position: z.enum(["top", "left"]).default("top"),
  }),
  example: { steps: [{ label: "Diagnóstico", at: 0.3 }, { label: "Plano", at: 4 }, { label: "Execução", at: 8 }], position: "top" },
  labels: { steps: "Etapas", position: "Posição" },
  sounds: (params, duration) => params.steps.map((s, i) => ({ at: s.at ?? stepAt(i, params.steps.length, duration), sfx: i === 0 ? ("pop" as const) : ("click_suave" as const) })),
  draw({ ctx, params, brand, t, duration, width: W, height: H, u, safe, region }) {
    const out = fadeOut(t, duration, 0.3);
    const e = EASE.snap(stage(t, 0, 0.45));
    const n = params.steps.length;
    const starts = params.steps.map((s, i) => s.at ?? stepAt(i, n, duration));
    const current = starts.reduce((k, s, i) => (t >= s ? i : k), 0);
    const left = params.position === "left";
    ctx.save();
    ctx.globalAlpha = out * clamp01(e * 1.6);
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 10 * u;
    const gap = 10 * u;
    const thick = 10 * u;
    if (left) {
      const x = safe.left + 6 * u;
      const y0 = safe.top + 60 * u;
      const len = (H - safe.top - safe.bottom - 120 * u - gap * (n - 1)) / n;
      ctx.translate(-40 * u * (1 - e), 0);
      params.steps.forEach((s, i) => {
        const y = y0 + i * (len + gap);
        const end = starts[i + 1] ?? duration - 0.3;
        const k = clamp01((t - starts[i]!) / Math.max(0.2, end - starts[i]!));
        ctx.fillStyle = rgba(brand.textColor, 0.28);
        roundRect(ctx, x, y, thick, len, thick / 2);
        ctx.fill();
        ctx.fillStyle = brand.primaryColor;
        if (k > 0) {
          roundRect(ctx, x, y, thick, Math.max(thick, len * k), thick / 2);
          ctx.fill();
        }
        if (i === current) {
          const lk = EASE.snap(stage(t, starts[i]!, 0.4));
          ctx.globalAlpha = out * lk;
          ctx.font = font(800, 44 * u);
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.fillStyle = brand.textColor;
          ctx.fillText(`${i + 1}. ${s.label}`, x + thick + 16 * u, y + 26 * u);
          region(`steps.${i}.label`, x + thick + 16 * u, y, ctx.measureText(`${i + 1}. ${s.label}`).width, 52 * u);
          ctx.globalAlpha = out * clamp01(e * 1.6);
        }
      });
    } else {
      const x0 = safe.left;
      const y = safe.top + 8 * u;
      const total = W - safe.left - safe.right;
      const len = (total - gap * (n - 1)) / n;
      ctx.translate(0, -30 * u * (1 - e));
      params.steps.forEach((s, i) => {
        const x = x0 + i * (len + gap);
        const end = starts[i + 1] ?? duration - 0.3;
        const k = clamp01((t - starts[i]!) / Math.max(0.2, end - starts[i]!));
        ctx.fillStyle = rgba(brand.textColor, 0.28);
        roundRect(ctx, x, y, len, thick, thick / 2);
        ctx.fill();
        if (k > 0) {
          ctx.fillStyle = brand.primaryColor;
          roundRect(ctx, x, y, Math.max(thick, len * k), thick, thick / 2);
          ctx.fill();
        }
      });
      // Nome da etapa atual sob a barra: troca com um deslize curto.
      const lk = EASE.snap(stage(t, starts[current]!, 0.4));
      const label = `${current + 1}/${n}  ${params.steps[current]!.label}`;
      ctx.globalAlpha = out * lk;
      ctx.font = font(800, 44 * u);
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = brand.textColor;
      ctx.fillText(label, x0 + 16 * u * (1 - lk), y + thick + 14 * u);
      region(`steps.${current}.label`, x0, y + thick + 14 * u, ctx.measureText(label).width, 40 * u);
      region("", x0, y, total, thick + 60 * u);
    }
    ctx.restore();
  },
});
const stepAt = (i: number, n: number, duration: number) => 0.3 + (i * Math.max(1, duration - 1)) / n;

// ---------------------------------------------------------------- custom_motion_graphic

const MG_EASE: Record<MgAnim["ease"], (x: number) => number> = {
  linear: clamp01,
  ease_out: easeOutCubic,
  ease_in_out: cubicBezier(0.65, 0, 0.35, 1),
  snap: EASE.snap,
  back: easeOutBack,
  spring: (x) => spring(x, { damping: 0.5, frequency: 1.5 }),
};

type AnimState = { opacity: number; tx: number; ty: number; scale: number; rotate: number; draw: number };

/** Valor de cada propriedade animada em `t`. Antes da primeira trilha de uma propriedade vale o `from` dela. */
export function animState(anims: MgAnim[], t: number): AnimState {
  const s: AnimState = { opacity: 1, tx: 0, ty: 0, scale: 1, rotate: 0, draw: 1 };
  const key = { opacity: "opacity", translateX: "tx", translateY: "ty", scale: "scale", rotate: "rotate", draw: "draw" } as const;
  const seen = new Set<string>();
  for (const a of [...anims].sort((x, y) => x.at - y.at)) {
    if (t < a.at) {
      if (!seen.has(a.prop)) s[key[a.prop]] = a.from;
    } else s[key[a.prop]] = a.from + (a.to - a.from) * MG_EASE[a.ease]((t - a.at) / a.duration);
    seen.add(a.prop);
  }
  return s;
}

type Size = { w: number; h: number; layout?: RichLayout; lines?: string[]; kids?: Size[]; cellW?: number; cellH?: number };

function paint(ctx: Ctx2D, color: MgColor | undefined, brand: BrandKit, x: number, y: number, w: number, h: number): string | CanvasGradient | null {
  if (color === undefined) return null;
  const one = (c: string) => (c === "primary" ? brand.primaryColor : c === "secondary" ? brand.secondaryColor : c === "background" ? brand.backgroundColor : c === "text" ? brand.textColor : c === "white" ? "#ffffff" : c === "black" ? INK : c);
  if (typeof color === "string") return one(color);
  const a = (color.angle * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.abs(Math.cos(a)) * (w / 2) + Math.abs(Math.sin(a)) * (h / 2);
  const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  g.addColorStop(0, one(color.from));
  g.addColorStop(1, one(color.to));
  return g;
}
const solid = (color: MgColor | undefined, brand: BrandKit, fallback: string) => {
  const c = typeof color === "string" ? color : color?.from;
  return c === undefined ? fallback : c === "primary" ? brand.primaryColor : c === "secondary" ? brand.secondaryColor : c === "background" ? brand.backgroundColor : c === "text" ? brand.textColor : c === "white" ? "#ffffff" : c === "black" ? INK : c;
};

function measure(ctx: Ctx2D, node: MgNode, brand: BrandKit, u: number, maxW: number): Size {
  switch (node.type) {
    case "text": {
      const limit = Math.min(maxW, (node.maxWidth ?? 1900) * u);
      if (node.font === "serif") {
        ctx.font = serifFont(node.size * u);
        const lines = wrapText(ctx, node.upper ? node.text.replace(/\*/g, "").toUpperCase() : node.text.replace(/\*/g, ""), limit);
        return { w: Math.min(limit, Math.max(...lines.map((l) => ctx.measureText(l).width))), h: lines.length * node.size * u * 1.15, lines };
      }
      const layout = layoutRich(ctx, node.text, { size: node.size * u, weight: node.weight, color: solid(node.color, brand, brand.textColor), emphColor: brand.primaryColor, upper: node.upper }, limit);
      return { w: layout.width, h: layout.height, layout };
    }
    case "rect":
    case "path":
      return { w: node.w * u, h: node.h * u };
    case "circle":
      return { w: node.r * 2 * u, h: node.r * 2 * u };
    case "line":
      return { w: Math.abs(node.x2) * u, h: Math.max(Math.abs(node.y2) * u, node.width * u) };
    case "badge": {
      ctx.font = font(800, node.size * u);
      return { w: ctx.measureText(node.text.toUpperCase()).width + node.size * u * 1.1, h: node.size * u * 1.7 };
    }
    case "group": {
      const pad = node.padding * u;
      const gap = node.gap * u;
      const inner = maxW - pad * 2;
      const share = node.layout === "row" ? inner / node.children.length : node.layout === "grid" ? (inner - gap * (node.columns - 1)) / node.columns : inner;
      const kids = node.children.map((c) => measure(ctx, c, brand, u, share));
      let w = 0;
      let h = 0;
      let cellW = 0;
      let cellH = 0;
      if (node.layout === "row") {
        w = kids.reduce((s, k) => s + k.w, 0) + gap * (kids.length - 1);
        h = Math.max(...kids.map((k) => k.h));
      } else if (node.layout === "column") {
        w = Math.max(...kids.map((k) => k.w));
        h = kids.reduce((s, k) => s + k.h, 0) + gap * (kids.length - 1);
      } else if (node.layout === "stack") {
        w = Math.max(...kids.map((k) => k.w));
        h = Math.max(...kids.map((k) => k.h));
      } else {
        const cols = Math.min(node.columns, kids.length);
        const rows = Math.ceil(kids.length / cols);
        cellW = Math.max(...kids.map((k) => k.w));
        cellH = Math.max(...kids.map((k) => k.h));
        w = cellW * cols + gap * (cols - 1);
        h = cellH * rows + gap * (rows - 1);
      }
      return { w: w + pad * 2, h: h + pad * 2, kids, cellW, cellH };
    }
  }
}

function drawNode(args: DrawArgs<unknown>, node: MgNode, size: Size, x: number, y: number) {
  const { ctx, brand, u, t } = args;
  const a = animState(node.anim, t);
  const alpha = clamp01(node.opacity * a.opacity);
  if (alpha <= 0.002) return;
  const ox = x + node.dx * u + a.tx * u;
  const oy = y + node.dy * u + a.ty * u;
  ctx.save();
  ctx.globalAlpha *= alpha;
  // Escala e rotação em torno do centro do nó.
  ctx.translate(ox + size.w / 2, oy + size.h / 2);
  if (a.rotate) ctx.rotate((a.rotate * Math.PI) / 180);
  if (a.scale !== 1) ctx.scale(Math.max(0, a.scale), Math.max(0, a.scale));
  ctx.translate(-size.w / 2, -size.h / 2);
  const { w, h } = size;
  switch (node.type) {
    case "text": {
      if (node.outline) {
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = node.size * u * 0.14;
        ctx.shadowOffsetY = node.size * u * 0.03;
      }
      if (size.layout) drawRich(ctx, size.layout, node.align === "center" ? w / 2 : node.align === "right" ? w : 0, 0, { align: node.align });
      else {
        ctx.font = serifFont(node.size * u);
        ctx.fillStyle = paint(ctx, node.color, brand, 0, 0, w, h) ?? brand.textColor;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = node.align;
        size.lines!.forEach((line, i) => ctx.fillText(line, node.align === "center" ? w / 2 : node.align === "right" ? w : 0, node.size * u * 0.82 + i * node.size * u * 1.15));
      }
      break;
    }
    case "rect":
    case "circle": {
      const r = node.type === "circle" ? w / 2 : node.radius * u;
      roundRect(ctx, 0, 0, w, h, r);
      const fill = paint(ctx, node.fill, brand, 0, 0, w, h);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      const stroke = paint(ctx, node.stroke, brand, 0, 0, w, h);
      if (stroke && node.strokeWidth) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = node.strokeWidth * u;
        ctx.stroke();
      }
      break;
    }
    case "line": {
      const x1 = node.x2 < 0 ? w : 0;
      const y1 = node.y2 < 0 ? h : 0;
      ctx.strokeStyle = paint(ctx, node.stroke, brand, 0, 0, w, h) ?? brand.primaryColor;
      ctx.lineWidth = node.width * u;
      ctx.lineCap = node.cap;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      // `draw` desenha a linha progressivamente a partir da origem.
      ctx.lineTo(x1 + node.x2 * u * clamp01(a.draw), y1 + node.y2 * u * clamp01(a.draw));
      ctx.stroke();
      break;
    }
    case "path": {
      if (typeof Path2D === "undefined") break;
      const path = new Path2D(node.d);
      ctx.scale(u, u);
      const fill = paint(ctx, node.fill, brand, 0, 0, node.w, node.h);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.globalAlpha *= node.stroke ? clamp01(a.draw * 2 - 1) : 1;
        ctx.fill(path);
        ctx.globalAlpha = ctx.globalAlpha;
      }
      const stroke = paint(ctx, node.stroke, brand, 0, 0, node.w, node.h);
      if (stroke && node.strokeWidth) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = node.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (a.draw < 1) {
          // Comprimento do caminho estimado pela caixa: o bastante para o traço "se desenhar".
          const len = (node.w + node.h) * 3;
          ctx.setLineDash([len, len]);
          ctx.lineDashOffset = len * (1 - clamp01(a.draw));
        }
        ctx.stroke(path);
      }
      break;
    }
    case "badge": {
      ctx.fillStyle = paint(ctx, node.fill, brand, 0, 0, w, h) ?? brand.primaryColor;
      roundRect(ctx, 0, 0, w, h, h / 2);
      ctx.fill();
      ctx.font = font(800, node.size * u);
      ctx.fillStyle = paint(ctx, node.color, brand, 0, 0, w, h) ?? INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.text.toUpperCase(), w / 2, h / 2 + node.size * u * 0.04);
      break;
    }
    case "group": {
      const pad = node.padding * u;
      const gap = node.gap * u;
      if (node.blur) args.backdropBlur(0, 0, w, h, node.radius * u);
      const fill = paint(ctx, node.fill, brand, 0, 0, w, h);
      const stroke = paint(ctx, node.stroke, brand, 0, 0, w, h);
      if (fill || (stroke && node.strokeWidth)) {
        roundRect(ctx, 0, 0, w, h, node.radius * u);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke && node.strokeWidth) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = node.strokeWidth * u;
          ctx.stroke();
        }
      }
      const kids = size.kids!;
      const iw = w - pad * 2;
      const ih = h - pad * 2;
      const cross = (free: number) => (node.align === "start" ? 0 : node.align === "end" ? free : free / 2);
      let cx = pad;
      let cy = pad;
      node.children.forEach((child, i) => {
        const k = kids[i]!;
        if (node.layout === "row") {
          drawNode(args, child, k, cx, pad + cross(ih - k.h));
          cx += k.w + gap;
        } else if (node.layout === "column") {
          drawNode(args, child, k, pad + cross(iw - k.w), cy);
          cy += k.h + gap;
        } else if (node.layout === "stack") drawNode(args, child, k, pad + (iw - k.w) / 2, pad + (ih - k.h) / 2);
        else {
          const cols = Math.min(node.columns, kids.length);
          const col = i % cols;
          const row = Math.floor(i / cols);
          drawNode(args, child, k, pad + col * (size.cellW! + gap) + cross(size.cellW! - k.w), pad + row * (size.cellH! + gap) + (size.cellH! - k.h) / 2);
        }
      });
      break;
    }
  }
  ctx.restore();
}

const customMotionGraphic = define({
  id: "custom_motion_graphic",
  name: "Motion gráfico sob medida",
  description:
    "Peça de motion design desenhada por você, quando nenhum componente pronto serve: uma árvore declarativa de formas vetoriais (rect, circle, line, path SVG), badges, textos estilizados, grupos com layout flex (row/column), grid ou stack, cores do Brand Kit ou gradientes, e trilhas de animação por nó (opacity, translateX/Y, scale, rotate, draw) com curvas de easing (ease_out, snap, back, spring…). Unidades em u (1u = 1 px num quadro de 1080 no lado menor). Regras: o texto NUNCA repete a fala; título com 64 px ou mais no 9:16 (role: \"title\"); toda animação termina pelo menos 0,5 s antes do fim (pausa final limpa); sem emoji nem gradiente roxo-azul genérico; no máximo 40 nós e 4 níveis.",
  defaultDuration: 4,
  schema: MotionGraphicSchema,
  example: {
    anchor: "bottom",
    offsetY: -0.08,
    root: {
      type: "group",
      layout: "column",
      align: "start",
      gap: 14,
      padding: 36,
      radius: 28,
      fill: "background",
      blur: true,
      anim: [
        { prop: "opacity", from: 0, to: 1, duration: 0.35 },
        { prop: "translateY", from: 60, to: 0, duration: 0.6, ease: "spring" },
      ],
      children: [
        { type: "badge", text: "Regra 80/20", anim: [{ prop: "scale", from: 0, to: 1, at: 0.2, duration: 0.5, ease: "back" }] },
        { type: "text", text: "Poucos clientes, *quase todo* o lucro", size: 68, role: "title", align: "left", maxWidth: 760 },
        { type: "line", x2: 520, y2: 0, stroke: "primary", width: 8, anim: [{ prop: "draw", from: 0, to: 1, at: 0.5, duration: 0.7, ease: "snap" }] },
      ],
    },
  },
  labels: { anchor: "Posição", offsetX: "Ajuste horizontal", offsetY: "Ajuste vertical", backdrop: "Fundo", exit: "Saída (s)", keepCaptions: "Manter legenda" },
  sounds: () => [{ at: 0.05, sfx: "swoosh_texto" as const }],
  draw(args) {
    const { ctx, params, brand, t, duration, width: W, height: H, safe, region } = args;
    const u = getUnit();
    const out = fadeOut(t, duration, params.exit);
    const sw = W - safe.left - safe.right;
    const sh = H - safe.top - safe.bottom;
    ctx.save();
    ctx.globalAlpha = out;
    if (params.backdrop !== "none") {
      const k = Math.min(easeOutCubic(stage(t, 0, 0.35)), out);
      ctx.save();
      ctx.globalAlpha = params.backdrop === "dim" ? 0.6 * k : k;
      ctx.fillStyle = params.backdrop === "dim" ? "#000" : brand.backgroundColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    const size = measure(ctx, params.root, brand, u, sw);
    // A peça é encolhida, se preciso, para caber inteira na área segura.
    const fit = Math.min(1, sw / Math.max(size.w, 1), sh / Math.max(size.h, 1));
    const [vy, vx] = params.anchor.includes("-") ? (params.anchor.split("-") as [string, string]) : params.anchor === "left" || params.anchor === "right" ? ["center", params.anchor] : [params.anchor === "center" ? "center" : params.anchor, "center"];
    const w = size.w * fit;
    const h = size.h * fit;
    const x = Math.min(W - safe.right - w, Math.max(safe.left, (vx === "left" ? safe.left : vx === "right" ? W - safe.right - w : safe.left + (sw - w) / 2) + params.offsetX * W));
    const y = Math.min(H - safe.bottom - h, Math.max(safe.top, (vy === "top" ? safe.top : vy === "bottom" ? H - safe.bottom - h : safe.top + (sh - h) / 2) + params.offsetY * H));
    ctx.translate(x, y);
    ctx.scale(fit, fit);
    drawNode(args as DrawArgs<unknown>, params.root, size, 0, 0);
    // A peça ocupa esta área: quando convive com a legenda, ela desvia.
    region("", 0, 0, size.w, size.h);
    ctx.restore();
  },
});
void enter;

export const V2_COMPONENTS = [statCounterCard, comparisonSplit, tacticalHud, socialProofToast, calloutPointer, stepProgressBar, customMotionGraphic];
