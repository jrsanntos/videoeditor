import { z } from "zod";

/**
 * custom_motion_graphic: árvore declarativa que o Diretor de IA escreve quando
 * nenhum componente pronto serve. Não é código: são formas, textos, layouts e
 * trilhas de animação que o renderizador desenha de forma segura. Tudo aqui é
 * limitado (profundidade, quantidade de nós, tamanhos) para que nenhuma árvore
 * gerada consiga travar ou quebrar o quadro.
 *
 * Unidades: `u` = 1 px num quadro cujo lado menor tem 1080.
 */

export const MG_LIMITS = { depth: 4, nodes: 40, children: 12, anims: 6 } as const;

const colorToken = z.enum(["primary", "secondary", "background", "text", "white", "black"]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const gradient = z.object({ from: z.union([colorToken, hex]), to: z.union([colorToken, hex]), angle: z.number().min(0).max(360).default(90) });
export const MgColorSchema = z.union([colorToken, hex, gradient]).describe('cor: token do Brand Kit ("primary", "text"…), hex, ou gradiente {from, to, angle}');
export type MgColor = z.infer<typeof MgColorSchema>;

export const MG_EASINGS = ["linear", "ease_out", "ease_in_out", "snap", "back", "spring"] as const;

export const MgAnimSchema = z.object({
  prop: z.enum(["opacity", "translateX", "translateY", "scale", "rotate", "draw"]).describe("draw: 0→1 desenha uma linha/caminho; translate em u; rotate em graus"),
  from: z.number().min(-2000).max(2000),
  to: z.number().min(-2000).max(2000),
  at: z.number().min(0).max(30).default(0).describe("início, em segundos desde a entrada do componente"),
  duration: z.number().min(0.05).max(10).default(0.5),
  ease: z.enum(MG_EASINGS).default("ease_out"),
});
export type MgAnim = z.infer<typeof MgAnimSchema>;

const base = {
  dx: z.number().min(-1200).max(1200).default(0).describe("deslocamento em u a partir da posição de layout"),
  dy: z.number().min(-2000).max(2000).default(0),
  opacity: z.number().min(0).max(1).default(1),
  anim: z.array(MgAnimSchema).max(MG_LIMITS.anims).default([]),
};

const TextNode = z.object({
  type: z.literal("text"),
  text: z.string().min(1).max(120).describe("*asteriscos* marcam a ênfase (cor de destaque)"),
  size: z.number().min(18).max(320).default(64),
  weight: z.number().int().min(300).max(900).default(800),
  color: MgColorSchema.default("text"),
  font: z.enum(["sans", "serif"]).default("sans"),
  align: z.enum(["left", "center", "right"]).default("center"),
  upper: z.boolean().default(false),
  maxWidth: z.number().min(80).max(1900).optional().describe("largura máxima em u antes de quebrar linha"),
  outline: z.boolean().default(false).describe("contorno escuro para ler sobre o vídeo"),
  role: z.enum(["title", "body", "label"]).default("body"),
  ...base,
});
const RectNode = z.object({
  type: z.literal("rect"),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1920),
  radius: z.number().min(0).max(400).default(0),
  fill: MgColorSchema.optional(),
  stroke: MgColorSchema.optional(),
  strokeWidth: z.number().min(0).max(40).default(0),
  ...base,
});
const CircleNode = z.object({
  type: z.literal("circle"),
  r: z.number().min(1).max(900),
  fill: MgColorSchema.optional(),
  stroke: MgColorSchema.optional(),
  strokeWidth: z.number().min(0).max(40).default(0),
  ...base,
});
const LineNode = z.object({
  type: z.literal("line"),
  x2: z.number().min(-1900).max(1900),
  y2: z.number().min(-1900).max(1900),
  stroke: MgColorSchema.default("primary"),
  width: z.number().min(1).max(40).default(6),
  cap: z.enum(["round", "butt"]).default("round"),
  ...base,
});
const PathNode = z.object({
  type: z.literal("path"),
  d: z
    .string()
    .min(3)
    .max(800)
    .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-+eE]+$/, "apenas comandos de caminho SVG")
    .describe("caminho SVG (atributo d), desenhado numa caixa w×h"),
  w: z.number().min(1).max(1920),
  h: z.number().min(1).max(1920),
  fill: MgColorSchema.optional(),
  stroke: MgColorSchema.optional(),
  strokeWidth: z.number().min(0).max(40).default(0),
  ...base,
});
const BadgeNode = z.object({
  type: z.literal("badge"),
  text: z.string().min(1).max(32),
  size: z.number().min(18).max(96).default(34),
  fill: MgColorSchema.default("primary"),
  color: MgColorSchema.default("black"),
  ...base,
});

export type MgNode =
  | z.infer<typeof TextNode>
  | z.infer<typeof RectNode>
  | z.infer<typeof CircleNode>
  | z.infer<typeof LineNode>
  | z.infer<typeof PathNode>
  | z.infer<typeof BadgeNode>
  | MgGroup;
export type MgGroup = {
  type: "group";
  layout: "row" | "column" | "stack" | "grid";
  gap: number;
  columns: number;
  align: "start" | "center" | "end";
  padding: number;
  fill?: MgColor;
  stroke?: MgColor;
  strokeWidth: number;
  radius: number;
  blur: boolean;
  children: MgNode[];
  dx: number;
  dy: number;
  opacity: number;
  anim: MgAnim[];
};

const GroupNode: z.ZodType<MgGroup, unknown> = z.lazy(() =>
  z.object({
    type: z.literal("group"),
    layout: z.enum(["row", "column", "stack", "grid"]).default("column").describe("row/column = flex; grid usa `columns`; stack empilha no centro"),
    gap: z.number().min(0).max(400).default(16),
    columns: z.number().int().min(1).max(6).default(2),
    align: z.enum(["start", "center", "end"]).default("center"),
    padding: z.number().min(0).max(200).default(0),
    fill: MgColorSchema.optional().describe("fundo do grupo (cartão)"),
    stroke: MgColorSchema.optional(),
    strokeWidth: z.number().min(0).max(40).default(0),
    radius: z.number().min(0).max(400).default(0),
    blur: z.boolean().default(false).describe("desfoca o vídeo atrás do cartão (backdrop blur)"),
    children: z.array(MgNodeSchema).min(1).max(MG_LIMITS.children),
    ...base,
  }),
);

export const MgNodeSchema: z.ZodType<MgNode, unknown> = z.lazy(() => z.union([TextNode, RectNode, CircleNode, LineNode, PathNode, BadgeNode, GroupNode]));

export const MG_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

export const MotionGraphicSchema = z
  .object({
    anchor: z.enum(MG_ANCHORS).default("center").describe("onde a peça fica dentro da área segura"),
    offsetX: z.number().min(-0.5).max(0.5).default(0).describe("ajuste em fração da largura do quadro"),
    offsetY: z.number().min(-0.5).max(0.5).default(0),
    backdrop: z.enum(["none", "dim", "solid"]).default("none").describe("dim escurece o vídeo; solid cobre com a cor de fundo do Brand Kit (cena de tela cheia)"),
    exit: z.number().min(0.1).max(1.5).default(0.3).describe("duração do fade de saída (s)"),
    keepCaptions: z.boolean().default(false).describe("true: peça pequena que convive com a legenda. Por padrão a legenda some enquanto a peça está na tela"),
    root: MgNodeSchema,
  })
  .superRefine((spec, ctx) => {
    const stats = mgStats(spec.root);
    if (stats.depth > MG_LIMITS.depth) ctx.addIssue({ code: "custom", message: `árvore profunda demais (${stats.depth} níveis; máximo ${MG_LIMITS.depth})` });
    if (stats.nodes > MG_LIMITS.nodes) ctx.addIssue({ code: "custom", message: `nós demais (${stats.nodes}; máximo ${MG_LIMITS.nodes})` });
  });
export type MotionGraphic = z.infer<typeof MotionGraphicSchema>;

/** Percorre a árvore em profundidade. */
export function walkMg(node: MgNode, visit: (n: MgNode, depth: number) => void, depth = 1) {
  visit(node, depth);
  if (node.type === "group") for (const c of node.children) walkMg(c, visit, depth + 1);
}

export function mgStats(root: MgNode): { depth: number; nodes: number; texts: { text: string; size: number; role: string }[]; animEnd: number } {
  const out = { depth: 0, nodes: 0, texts: [] as { text: string; size: number; role: string }[], animEnd: 0 };
  walkMg(root, (n, d) => {
    out.depth = Math.max(out.depth, d);
    out.nodes++;
    if (n.type === "text") out.texts.push({ text: n.text, size: n.size, role: n.role });
    if (n.type === "badge") out.texts.push({ text: n.text, size: n.size, role: "label" });
    for (const a of n.anim ?? []) out.animEnd = Math.max(out.animEnd, (a.at ?? 0) + (a.duration ?? 0.5));
  });
  return out;
}
