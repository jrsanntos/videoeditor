import { z } from "zod";
import type { BrandKit, SafeArea } from "@videoeditor/core";
import { V1_COMPONENTS } from "./v1";
import {
  type Ctx2D,
  easeOutBack,
  easeOutCubic,
  fitText,
  font,
  formatNumber,
  presence,
  roundRect,
  stage,
  wrapText,
} from "../draw";

/**
 * Biblioteca de componentes paramétricos pré-validados.
 *
 * O agente NÃO programa animações: ele escolhe um id e preenche `params`
 * (validados por zod). Isso corta ~80% dos tokens por cena, elimina bugs
 * visuais e permite usar modelos mais baratos. Cada `draw` é uma função pura
 * de (params, tempo) em Canvas 2D — o mesmo código serve o preview no
 * navegador, a exportação via WebCodecs e o render em nuvem.
 */

export type DrawArgs<P> = {
  ctx: Ctx2D;
  params: P;
  /** Segundos desde o início do clip. */
  t: number;
  duration: number;
  width: number;
  height: number;
  /** Unidade de layout: 1u = 1px num quadro de 1080 de altura. */
  u: number;
  /** Brand Kit do projeto: cores e credencial usados quando o clip não define os seus. */
  brand: BrandKit;
  /** Margens que textos e tarjas respeitam (interface de Reels/TikTok/Shorts no vertical). */
  safe: SafeArea;
  vertical: boolean;
  /** Há recorte do apresentador para este quadro (segmentação pronta). */
  hasPerson: boolean;
  /** Redesenha o apresentador por cima do que já foi desenhado (texto atrás da pessoa). */
  drawPerson: () => void;
};

export type SfxId = "whoosh" | "tick" | "pop" | "riser";
/** Efeito sonoro em `at` segundos desde o início do componente. */
export type SoundCue = { at: number; sfx: SfxId };

export type ComponentDef<S extends z.ZodType = z.ZodType> = {
  id: string;
  name: string;
  description: string;
  defaultDuration: number;
  schema: S;
  example: z.input<S>;
  draw: (args: DrawArgs<z.output<S>>) => void;
  /** Efeitos sonoros sincronizados com a animação. */
  sounds?: (params: z.output<S>, duration: number) => SoundCue[];
  /** Precisa do recorte do apresentador (segmentação) enquanto está na tela. */
  needsPerson?: boolean;
  /** false: fica só no menu manual; o agente não recebe no catálogo. */
  agent?: boolean;
};

const define = <S extends z.ZodType>(def: ComponentDef<S>) => def;

const accent = z.string().optional().describe("cor de destaque (hex). Omita para usar a cor do Brand Kit do usuário");
const INK = "#0b0b10";
const PAPER = "#ffffff";

const lowerThird = define({
  id: "lower_third",
  name: "Lower third",
  description:
    "Tarja inferior com nome e cargo/legenda. Use para apresentar quem fala ou rotular um assunto.",
  defaultDuration: 4,
  schema: z.object({
    title: z.string().max(40).optional().describe("nome. Omita para usar o nome do Brand Kit"),
    subtitle: z.string().max(60).optional().describe("cargo/registro. Omita para usar a credencial do Brand Kit"),
    accent,
  }),
  example: { title: "Ana Souza", subtitle: "Especialista em tráfego pago" },
  draw({ ctx, params: raw, brand, t, duration, height, u }) {
    const params = { ...raw, title: raw.title ?? brand.displayName, subtitle: raw.subtitle ?? (raw.title ? undefined : brand.credential || undefined) };
    if (!params.title) return;
    const p = presence(t, duration, 0.5, 0.35);
    const x = 80 * u;
    const baseY = height - 220 * u;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(-60 * u * (1 - p), 0);
    ctx.font = font(800, 54 * u);
    const tw = ctx.measureText(params.title).width;
    ctx.font = font(500, 32 * u);
    const sw = params.subtitle ? ctx.measureText(params.subtitle).width : 0;
    const w = Math.max(tw, sw) + 72 * u;
    const h = (params.subtitle ? 140 : 96) * u;
    ctx.fillStyle = "rgba(11,11,16,0.86)";
    roundRect(ctx, x, baseY, w, h, 14 * u);
    ctx.fill();
    ctx.fillStyle = (params.accent ?? brand.primaryColor);
    roundRect(ctx, x, baseY, 10 * u, h * easeOutCubic(stage(t, 0.1, 0.4)), 5 * u);
    ctx.fill();
    ctx.textBaseline = "top";
    ctx.fillStyle = PAPER;
    ctx.font = font(800, 54 * u);
    ctx.fillText(params.title, x + 40 * u, baseY + 20 * u);
    if (params.subtitle) {
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = font(500, 32 * u);
      ctx.fillText(params.subtitle, x + 40 * u, baseY + 86 * u);
    }
    ctx.restore();
  },
});

const titleCard = define({
  id: "title_card",
  name: "Cartela de título",
  description:
    "Cartela em tela cheia com título e subtítulo. Use para abrir o vídeo ou marcar a troca de capítulo.",
  defaultDuration: 3,
  schema: z.object({
    title: z.string().max(60),
    subtitle: z.string().max(90).optional(),
    background: z.string().default(INK).describe("cor de fundo (hex)"),
    accent,
  }),
  example: { title: "3 erros que travam suas vendas", subtitle: "Parte 1 — Oferta" },
  draw({ ctx, params, brand, t, duration, width, height, u }) {
    const p = presence(t, duration, 0.35, 0.35);
    ctx.save();
    ctx.globalAlpha = p;
    ctx.fillStyle = params.background;
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(800, 92 * u);
    const lines = wrapText(ctx, params.title, width * 0.8);
    const lh = 108 * u;
    const blockH = lines.length * lh + (params.subtitle ? 80 * u : 0);
    let y = height / 2 - blockH / 2 + lh / 2;
    const rise = easeOutCubic(stage(t, 0.1, 0.6));
    ctx.fillStyle = PAPER;
    for (const line of lines) {
      ctx.fillText(line, width / 2, y + 40 * u * (1 - rise));
      y += lh;
    }
    const barW = 160 * u * easeOutCubic(stage(t, 0.3, 0.5));
    ctx.fillStyle = (params.accent ?? brand.primaryColor);
    roundRect(ctx, width / 2 - barW / 2, y - lh / 2 + 14 * u, barW, 8 * u, 4 * u);
    ctx.fill();
    if (params.subtitle) {
      ctx.globalAlpha = p * stage(t, 0.45, 0.4);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = font(500, 40 * u);
      ctx.fillText(params.subtitle, width / 2, y + 30 * u);
    }
    ctx.restore();
  },
});

const barChart = define({
  id: "bar_chart",
  name: "Gráfico de barras",
  description:
    "Gráfico de barras animado sobre o vídeo escurecido. Use quando a fala citar números comparáveis (faturamento, crescimento, antes/depois). Preencha `at` de cada barra com o instante (segundos desde o início do componente) em que aquele número é dito, para a barra subir junto com a fala.",
  defaultDuration: 6,
  schema: z.object({
    title: z.string().max(60).optional(),
    bars: z
      .array(
        z.object({
          label: z.string().max(16),
          value: z.number().min(0),
          at: z
            .number()
            .min(0)
            .optional()
            .describe("segundos desde o início do componente em que a barra sobe (quando o número é dito)"),
        }),
      )
      .min(2)
      .max(6),
    prefix: z.string().max(4).default("").describe('ex.: "R$ "'),
    suffix: z.string().max(4).default("").describe('ex.: "%" ou "k"'),
    accent,
  }),
  example: {
    title: "Faturamento por trimestre",
    bars: [
      { label: "T1", value: 120, at: 0.3 },
      { label: "T2", value: 180, at: 2.6 },
      { label: "T3", value: 310, at: 4.4 },
    ],
    prefix: "R$ ",
    suffix: "k",
  },
  draw({ ctx, params, brand, t, duration, width, height, u }) {
    const p = presence(t, duration, 0.4, 0.3);
    ctx.save();
    ctx.globalAlpha = p * 0.72;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = p;
    const padX = width * 0.14;
    const top = height * 0.2;
    const bottom = height * 0.8;
    if (params.title) {
      ctx.fillStyle = PAPER;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      fitText(ctx, params.title, 800, 56 * u, width - padX * 2);
      ctx.fillText(params.title, padX, top - 30 * u);
    }
    const n = params.bars.length;
    const max = Math.max(...params.bars.map((b) => b.value), 1e-9);
    const slot = (width - padX * 2) / n;
    const bw = Math.min(slot * 0.62, 220 * u);
    const chartH = bottom - top - 70 * u;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(padX, bottom, width - padX * 2, 2 * u);
    params.bars.forEach((bar, i) => {
      const enter = bar.at ?? 0.25 + i * 0.14;
      const g = easeOutCubic(stage(t, enter, 0.7));
      // Antes de subir a barra não aparece: nada de "R$ 0k" esperando a fala.
      ctx.globalAlpha = p * stage(t, enter, 0.2);
      const h = chartH * (bar.value / max) * g;
      const x = padX + slot * i + (slot - bw) / 2;
      const isMax = bar.value === max;
      ctx.fillStyle = isMax ? (params.accent ?? brand.primaryColor) : "rgba(255,255,255,0.82)";
      roundRect(ctx, x, bottom - h, bw, h, 10 * u);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = PAPER;
      ctx.textBaseline = "alphabetic";
      ctx.font = font(800, 38 * u);
      ctx.fillText(
        `${params.prefix}${formatNumber(bar.value * g, Number.isInteger(bar.value) ? 0 : 1)}${params.suffix}`,
        x + bw / 2,
        bottom - h - 16 * u,
      );
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = font(500, 30 * u);
      ctx.fillText(bar.label, x + bw / 2, bottom + 18 * u);
    });
    ctx.globalAlpha = p;
    ctx.restore();
  },
});

const counter = define({
  id: "counter",
  name: "Contador",
  description:
    "Número grande que conta até o valor final, com rótulo. Use para destacar UM dado de impacto (ex.: +250% de conversão, R$ 1,2 mi).",
  defaultDuration: 4,
  schema: z.object({
    to: z.number(),
    from: z.number().default(0),
    prefix: z.string().max(4).default(""),
    suffix: z.string().max(6).default(""),
    decimals: z.number().int().min(0).max(2).default(0),
    label: z.string().max(60).optional(),
    accent,
  }),
  example: { to: 250, prefix: "+", suffix: "%", label: "de aumento na conversão" },
  draw({ ctx, params, brand, t, duration, width, height, u }) {
    const p = presence(t, duration, 0.3, 0.3);
    const k = easeOutCubic(stage(t, 0.15, Math.min(1.6, duration * 0.5)));
    const value = params.from + (params.to - params.from) * k;
    const text = `${params.prefix}${formatNumber(value, params.decimals)}${params.suffix}`;
    ctx.save();
    ctx.globalAlpha = p * 0.6;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = p;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const pop = 0.85 + 0.15 * easeOutBack(stage(t, 0, 0.45));
    ctx.translate(width / 2, height / 2 - (params.label ? 30 * u : 0));
    ctx.scale(pop, pop);
    ctx.fillStyle = (params.accent ?? brand.primaryColor);
    fitText(ctx, text, 900, 220 * u, width * 0.85);
    ctx.fillText(text, 0, 0);
    ctx.scale(1 / pop, 1 / pop);
    if (params.label) {
      ctx.globalAlpha = p * stage(t, 0.4, 0.4);
      ctx.fillStyle = PAPER;
      fitText(ctx, params.label, 600, 46 * u, width * 0.8);
      ctx.fillText(params.label, 0, 160 * u);
    }
    ctx.restore();
  },
});

const textHighlight = define({
  id: "text_highlight",
  name: "Frase em destaque",
  description:
    "Frase curta na tela com um trecho grifado por marca-texto animado. Use para reforçar a ideia-chave de um trecho da fala.",
  defaultDuration: 3.5,
  schema: z.object({
    text: z.string().max(80),
    highlight: z.string().max(40).optional().describe("trecho exato de `text` a grifar"),
    position: z.enum(["top", "center", "bottom"]).default("center"),
    accent,
  }),
  example: { text: "Preço não é o problema, oferta é.", highlight: "oferta é" },
  draw({ ctx, params, brand, t, duration, width, height, u }) {
    const p = presence(t, duration, 0.3, 0.25);
    ctx.save();
    ctx.globalAlpha = p;
    ctx.font = font(800, 72 * u);
    const lines = wrapText(ctx, params.text, width * 0.78);
    const lh = 96 * u;
    const blockH = lines.length * lh;
    const cy =
      params.position === "top" ? height * 0.2 : params.position === "bottom" ? height * 0.72 : height / 2;
    const hl = params.highlight?.trim();
    const sweep = easeOutCubic(stage(t, 0.35, 0.5));
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    lines.forEach((line, i) => {
      const y = cy - blockH / 2 + lh / 2 + i * lh;
      const lw = ctx.measureText(line).width;
      const x = width / 2 - lw / 2;
      const rise = easeOutCubic(stage(t, i * 0.08, 0.4));
      ctx.globalAlpha = p * rise;
      const idx = hl ? line.toLowerCase().indexOf(hl.toLowerCase()) : -1;
      if (hl && idx >= 0) {
        const pre = ctx.measureText(line.slice(0, idx)).width;
        const hw = ctx.measureText(line.slice(idx, idx + hl.length)).width;
        ctx.fillStyle = (params.accent ?? brand.primaryColor);
        roundRect(ctx, x + pre - 10 * u, y - 44 * u, (hw + 20 * u) * sweep, 88 * u, 10 * u);
        ctx.fill();
      }
      ctx.lineWidth = 10 * u;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(11,11,16,0.9)";
      ctx.strokeText(line, x, y + 20 * u * (1 - rise));
      ctx.fillStyle = PAPER;
      ctx.fillText(line, x, y + 20 * u * (1 - rise));
      if (hl && idx >= 0 && sweep > 0.5) {
        const pre = ctx.measureText(line.slice(0, idx)).width;
        ctx.fillStyle = INK;
        ctx.fillText(line.slice(idx, idx + hl.length), x + pre, y);
      }
    });
    ctx.restore();
  },
});

const bulletList = define({
  id: "bullet_list",
  name: "Lista de tópicos",
  description:
    "Painel lateral com título e tópicos que entram um a um. Use quando a fala enumera passos, benefícios ou erros.",
  defaultDuration: 6,
  schema: z.object({
    title: z.string().max(40).optional(),
    items: z.array(z.string().max(48)).min(1).max(5),
    side: z.enum(["left", "right"]).default("right"),
    accent,
  }),
  example: { title: "O que você vai aprender", items: ["Montar a oferta", "Escrever o gancho", "Fechar a venda"] },
  draw({ ctx, params, brand, t, duration, width, height, u }) {
    const p = presence(t, duration, 0.45, 0.3);
    const w = Math.min(width * 0.42, 760 * u);
    const rowH = 84 * u;
    const h = (params.title ? 110 * u : 40 * u) + params.items.length * rowH + 30 * u;
    const x = params.side === "right" ? width - w - 70 * u : 70 * u;
    const y = height / 2 - h / 2;
    const dir = params.side === "right" ? 1 : -1;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate(dir * 80 * u * (1 - p), 0);
    ctx.fillStyle = "rgba(11,11,16,0.88)";
    roundRect(ctx, x, y, w, h, 22 * u);
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let cy = y + 40 * u;
    if (params.title) {
      ctx.fillStyle = (params.accent ?? brand.primaryColor);
      fitText(ctx, params.title, 800, 42 * u, w - 80 * u);
      ctx.fillText(params.title, x + 40 * u, y + 62 * u);
      cy = y + 110 * u;
    }
    params.items.forEach((item, i) => {
      const s = easeOutCubic(stage(t, 0.4 + i * 0.35, 0.4));
      const iy = cy + rowH * i + rowH / 2;
      ctx.globalAlpha = p * s;
      ctx.fillStyle = (params.accent ?? brand.primaryColor);
      roundRect(ctx, x + 40 * u, iy - 22 * u, 44 * u, 44 * u, 10 * u);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.font = font(800, 28 * u);
      ctx.fillText(String(i + 1), x + 62 * u, iy + 1 * u);
      ctx.textAlign = "left";
      ctx.fillStyle = PAPER;
      fitText(ctx, item, 600, 36 * u, w - 150 * u);
      ctx.fillText(item, x + 106 * u + 24 * u * (1 - s), iy);
    });
    ctx.restore();
  },
});

// Os seis da v1.0 são o vocabulário do agente; os anteriores seguem disponíveis no menu manual.
const LEGACY = [lowerThird, titleCard, barChart, counter, textHighlight, bulletList].map((c) => ({ ...c, agent: false }) as ComponentDef);
export const COMPONENTS: Record<string, ComponentDef> = Object.fromEntries(
  [...(V1_COMPONENTS as unknown as ComponentDef[]), ...LEGACY].map((c) => [c.id, c]),
);

/** Valida e normaliza (aplica defaults) os params de um componente. Lança se inválido. */
export function validateComponent(component: string, params: Record<string, unknown>): Record<string, unknown> {
  const def = COMPONENTS[component];
  if (!def)
    throw new Error(
      `componente "${component}" não existe. Disponíveis: ${Object.values(COMPONENTS).filter((c) => c.agent !== false).map((c) => c.id).join(", ")}`,
    );
  const parsed = def.schema.safeParse(params);
  if (!parsed.success) throw new Error(`params inválidos para ${component}: ${z.prettifyError(parsed.error)}`);
  return parsed.data as Record<string, unknown>;
}

/** Catálogo em texto para o prompt de sistema do agente. */
export function catalogForAgent(): string {
  return Object.values(COMPONENTS)
    .filter((c) => c.agent !== false)
    .map(
      (c) =>
        `### ${c.id} — ${c.name}\n${c.description}\nDuração sugerida: ${c.defaultDuration}s\nparams (JSON Schema): ${JSON.stringify(
          z.toJSONSchema(c.schema, { io: "input" }),
        )}\nExemplo: ${JSON.stringify(c.example)}`,
    )
    .join("\n\n");
}
