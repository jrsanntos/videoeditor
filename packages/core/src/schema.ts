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
});
export type ZoomClip = z.infer<typeof ZoomClipSchema>;

export const ComponentClipSchema = z.object({
  ...clipBase,
  type: z.literal("component"),
  /** id de um componente da biblioteca pré-validada (@videoeditor/renderer). */
  component: z.string(),
  params: z.record(z.string(), z.unknown()),
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
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

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
});
export type Project = z.infer<typeof ProjectSchema>;

export type TimeRange = { start: number; end: number };
