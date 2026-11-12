import { z } from "zod";

/**
 * Timeline State — a única fonte de verdade de uma edição.
 * O agente e a UI nunca tocam em pixels: ambos apenas produzem operações
 * que transformam este JSON. Preview e exportação são funções puras dele.
 *
 * Todos os tempos são em segundos. `start` é tempo de timeline;
 * `sourceStart` é tempo dentro do arquivo de origem.
 */

export const WordSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  /**
   * Energia da voz nesta palavra, em dB relativos à mediana do apresentador
   * (medida no navegador). Positivo = dita com mais força: ênfase real.
   */
  energy: z.number().optional(),
  /** Some só da legenda; a fala e a transcrição continuam. */
  hidden: z.boolean().optional(),
  /** Deslocamento (s) da legenda desta palavra na timeline. */
  shift: z.number().min(-5).max(5).optional(),
});
export type Word = z.infer<typeof WordSchema>;

export const TranscriptSchema = z.object({
  language: z.string().optional(),
  /** Palavras em tempo de ORIGEM do asset. */
  words: z.array(WordSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio", "image"]),
  name: z.string(),
  duration: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  hasAudio: z.boolean().default(true),
  transcript: TranscriptSchema.optional(),
  /**
   * Onde o apresentador está no quadro de ORIGEM (frações 0–1), medido no
   * navegador por segmentação em alguns quadros. É o que permite ao agente e
   * ao compositor posicionar zooms e textos sem cobrir o rosto.
   */
  subject: z
    .array(
      z.object({
        t: z.number(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        /** Centro estimado do rosto. */
        faceX: z.number(),
        faceY: z.number(),
      }),
    )
    .optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

const clipBase = {
  id: z.string(),
  start: z.number().min(0),
  duration: z.number().positive(),
};

export const MediaClipSchema = z.object({
  ...clipBase,
  type: z.literal("media"),
  assetId: z.string(),
  sourceStart: z.number().min(0),
  volume: z.number().min(0).max(2).default(1),
});
export type MediaClip = z.infer<typeof MediaClipSchema>;

export const ZoomClipSchema = z.object({
  ...clipBase,
  type: z.literal("zoom"),
  scale: z.number().min(1).max(4),
  /** Ponto focal normalizado (0–1) dentro do quadro. */
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  /** Duração da rampa de entrada/saída, em segundos. 0 = corte seco (punch-in). */
  ease: z.number().min(0).default(0.25),
  /**
   * hold: entra em `ease`, segura e sai em `ease`.
   * creep: avança devagar de 1 até `scale` durante o clip inteiro e volta num corte.
   */
  mode: z.enum(["hold", "creep"]).default("hold"),
  /**
   * Deslocamento do quadro em fração da largura/altura. panX positivo leva o
   * apresentador para a direita (abre espaço à esquerda); negativo, o contrário.
   */
  panX: z.number().min(-0.5).max(0.5).default(0),
  panY: z.number().min(-0.5).max(0.5).default(0),
});
export type ZoomClip = z.infer<typeof ZoomClipSchema>;

export const ComponentClipSchema = z.object({
  ...clipBase,
  type: z.literal("component"),
  /** id de um componente da biblioteca pré-validada (@videoeditor/renderer). */
  component: z.string(),
  params: z.record(z.string(), z.unknown()),
  /** Ajustes visuais deste clip, feitos pelo usuário no editor de motion. */
  style: z
    .object({
      /** Deslocamento em fração da largura/altura do quadro. */
      dx: z.number().min(-1).max(1).default(0),
      dy: z.number().min(-1).max(1).default(0),
      scale: z.number().min(0.3).max(3).default(1),
      primaryColor: z.string().optional(),
      textColor: z.string().optional(),
      backgroundColor: z.string().optional(),
      fontPair: z.string().optional(),
    })
    .optional(),
});
export type ComponentClip = z.infer<typeof ComponentClipSchema>;

export const ClipSchema = z.discriminatedUnion("type", [
  MediaClipSchema,
  ZoomClipSchema,
  ComponentClipSchema,
]);
export type Clip = z.infer<typeof ClipSchema>;

/**
 * main    — vídeo falado; magnética (sem buracos), só clips `media`
 * fx      — zooms aplicados ao vídeo principal
 * overlay — componentes de motion design
 */
export const TrackKindSchema = z.enum(["main", "fx", "overlay"]);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const TrackSchema = z.object({
  id: z.string(),
  kind: TrackKindSchema,
  name: z.string(),
  clips: z.array(ClipSchema),
});
export type Track = z.infer<typeof TrackSchema>;

export const CaptionStyleSchema = z.object({
  preset: z.enum(["bold", "clean", "karaoke"]).default("karaoke"),
  position: z.enum(["top", "center", "bottom"]).default("bottom"),
  maxWords: z.number().int().min(1).max(10).default(4),
  color: z.string().default("#ffffff"),
  highlightColor: z.string().default("#facc15"),
  fontScale: z.number().min(0.5).max(2).default(1),
  /** Altura do centro da legenda (0 topo, 1 base). Quando definida, vale no lugar de `position`. */
  y: z.number().min(0.05).max(0.95).optional(),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor em hexadecimal, ex.: #0B0F19");

/** Pares tipográficos disponíveis: uma sem serifa forte + uma serifada itálica para ênfase. */
export const FONT_PAIRS = {
  "inter-instrument": { name: "Inter + Instrument Serif", sans: "Inter", serif: "Instrument Serif" },
  "montserrat-playfair": { name: "Montserrat + Playfair Display", sans: "Montserrat", serif: "Playfair Display" },
  "poppins-playfair": { name: "Poppins + Playfair Display", sans: "Poppins", serif: "Playfair Display" },
  "bebas-instrument": { name: "Bebas Neue + Instrument Serif", sans: "Bebas Neue", serif: "Instrument Serif" },
  "anton-playfair": { name: "Anton + Playfair Display", sans: "Anton", serif: "Playfair Display" },
  "oswald-instrument": { name: "Oswald + Instrument Serif", sans: "Oswald", serif: "Instrument Serif" },
} as const;
export type FontPairId = keyof typeof FONT_PAIRS;

/**
 * Brand Kit: a estética do usuário, definida uma vez e herdada por todos os
 * vídeos. Componentes e legendas usam estes valores quando o clip não define os seus.
 */
export const BrandKitSchema = z.object({
  primaryColor: hex.default("#FACC15").describe("cor de destaque principal"),
  secondaryColor: hex.default("#38BDF8").describe("cor de apoio"),
  backgroundColor: hex.default("#0B0F19").describe("fundo das cenas de tela cheia"),
  textColor: hex.default("#F8FAFC"),
  fontPair: z.enum(Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]]).default("inter-instrument"),
  displayName: z.string().max(40).default("").describe("nome exibido na tarja (ex.: Dra. Ana Silva)"),
  credential: z.string().max(60).default("").describe("registro ou cargo (ex.: CRM 12345, Personal Trainer)"),
  /** Desligado: nenhuma tarja de nome/cargo aparece no vídeo, e o agente não cria uma. */
  showLowerThird: z.boolean().default(true),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;
export const defaultBrandKit = (): BrandKit => BrandKitSchema.parse({});

export const ProjectSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  assets: z.record(z.string(), AssetSchema),
  tracks: z.array(TrackSchema),
  captions: z.object({
    enabled: z.boolean(),
    style: CaptionStyleSchema,
  }),
  // Com default: projetos salvos antes do Brand Kit continuam abrindo.
  brand: BrandKitSchema.default(defaultBrandKit),
  /** Formato do quadro. Projetos antigos (sem o campo) eram horizontais. */
  aspectRatio: z.enum(["9:16", "16:9"]).default("16:9"),
  /**
   * Reenquadramento: que parte do vídeo de origem fica visível quando ele é
   * recortado para preencher o quadro (0 = borda esquerda/superior, 1 = direita/inferior).
   */
  framing: z.object({ x: z.number().min(0).max(1).default(0.5), y: z.number().min(0).max(1).default(0.5) }).default({ x: 0.5, y: 0.5 }),
  /** Efeitos sonoros automáticos sincronizados com os movimentos visuais. */
  sfx: z.object({ enabled: z.boolean().default(true), volume: z.number().min(0).max(2).default(1) }).default({ enabled: true, volume: 1 }),
});

export type AspectRatio = Project["aspectRatio"];
export const FORMATS: Record<AspectRatio, { name: string; width: number; height: number }> = {
  "9:16": { name: "Vertical 9:16 (Reels, TikTok, Shorts)", width: 1080, height: 1920 },
  "16:9": { name: "Horizontal 16:9 (YouTube, VSL)", width: 1920, height: 1080 },
};

export type SafeArea = { top: number; right: number; bottom: number; left: number };

/**
 * Margens, em pixels do quadro, que textos e tarjas devem respeitar. No
 * vertical cobrem a interface de Reels/TikTok/Shorts: legenda e botões de
 * ação embaixo e à direita, cabeçalho em cima.
 */
export function safeArea(project: { width: number; height: number; aspectRatio: AspectRatio }): SafeArea {
  const { width: w, height: h } = project;
  return project.aspectRatio === "9:16"
    ? { top: Math.round(h * 0.13), right: Math.round(w * 0.14), bottom: Math.round(h * 0.21), left: Math.round(w * 0.06) }
    : { top: Math.round(h * 0.06), right: Math.round(w * 0.05), bottom: Math.round(h * 0.08), left: Math.round(w * 0.05) };
}
export type Project = z.infer<typeof ProjectSchema>;

export type TimeRange = { start: number; end: number };
