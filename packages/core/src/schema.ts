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
  /**
   * Confiança do transcritor no trecho desta palavra (0–1). Abaixo de
   * LOW_CONFIDENCE a palavra vai para a revisão rápida de legendas.
   */
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Não é palavra: som de hesitação ("hum", "é...") ou tentativa abandonada
   * antes da repetição ("incapaci-… incapacitação"), achados pela segunda
   * escuta e pelo áudio. A limpeza de fala corta sempre.
   */
  disfluency: z.enum(["hesitation", "false_start"]).optional(),
  /** O usuário já conferiu (ou corrigiu) esta palavra na revisão. */
  reviewed: z.boolean().optional(),
  /** Some só da legenda; a fala e a transcrição continuam. */
  hidden: z.boolean().optional(),
  /** Deslocamento (s) da legenda desta palavra na timeline. */
  shift: z.number().min(-5).max(5).optional(),
});
export type Word = z.infer<typeof WordSchema>;

/** Abaixo disto a palavra é marcada para conferência na legenda. */
export const LOW_CONFIDENCE = 0.55;

export const TranscriptSchema = z.object({
  language: z.string().optional(),
  /** Palavras em tempo de ORIGEM do asset. */
  words: z.array(WordSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/**
 * Perfil editorial do material bruto. Decide o playbook do Diretor de IA:
 * um vídeo de ação não é editado como um vídeo falado.
 */
export const GenreSchema = z.enum(["talking_head", "action_cinematic", "tutorial_demo", "vlog_montage"]);
export type Genre = z.infer<typeof GenreSchema>;
export const GENRE_NAMES: Record<Genre, string> = {
  talking_head: "Fala para a câmera",
  action_cinematic: "Ação / cinematográfico",
  tutorial_demo: "Tutorial / demonstração",
  vlog_montage: "Vlog / montagem",
};

const SrcRange = z.object({ start: z.number(), end: z.number() });

/** Tudo em tempo de ORIGEM do asset. Medido no navegador, sem custo. */
export const AssetAnalysisSchema = z.object({
  genre: GenreSchema,
  /** Por que o classificador escolheu o gênero (uma linha, para o agente e para o usuário). */
  reason: z.string().max(240).default(""),
  /** Movimento entre quadros (fluxo óptico aproximado por diferença), 0–1 normalizado pelo próprio vídeo. */
  motion: z.array(z.object({ t: z.number(), v: z.number() })).default([]),
  /** Mudanças de plano detectadas (s). */
  cuts: z.array(z.number()).default([]),
  /** Picos de energia visual e acústica, do mais forte ao mais fraco. */
  peaks: z.array(z.object({ t: z.number(), kind: z.enum(["visual", "audio", "both"]), strength: z.number() })).default([]),
  /** Trechos com voz ativa (VAD adaptativo). */
  speech: z.array(SrcRange).default([]),
  /** Piso de ruído (P15) e voz ativa (P85) do arquivo, em dBFS. */
  noiseFloorDb: z.number().optional(),
  speechDb: z.number().optional(),
  /** Fração do vídeo com voz ativa (0–1). */
  speechRatio: z.number().default(0),
  /** Movimento médio absoluto (0–1): separa câmera parada de cena de ação. */
  motionLevel: z.number().default(0),
});
export type AssetAnalysis = z.infer<typeof AssetAnalysisSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "audio", "image"]),
  name: z.string(),
  duration: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  hasAudio: z.boolean().default(true),
  /**
   * main: o vídeo falado. context: mídia de apoio (b-roll) que o usuário
   * enviou ou trouxe de um banco gratuito, para cobrir trechos da fala.
   */
  role: z.enum(["main", "context"]).optional(),
  /** O que a mídia de contexto mostra, em poucas palavras: é o que o agente lê para decidir onde usá-la. */
  description: z.string().max(200).optional(),
  /** Origem de mídia de banco gratuito, para dar o crédito. */
  credit: z.object({ provider: z.string(), author: z.string().optional(), url: z.string().optional() }).optional(),
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
        /** Tamanho estimado do rosto (frações do quadro de origem), quando medido. */
        faceW: z.number().optional(),
        faceH: z.number().optional(),
      }),
    )
    .optional(),
  /** SHA-256 do arquivo: chave do cache de transcrição e análise (nunca reprocessa o mesmo vídeo). */
  hash: z.string().optional(),
  /** Análise multimodal local (movimento, planos, energia acústica, gênero). */
  analysis: AssetAnalysisSchema.optional(),
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
  /** Velocidade constante (playbackRate). Ausente = 1x. */
  speed: z.number().min(0.25).max(4).optional(),
  /**
   * Rampa de velocidade: pontos (posição 0–1 dentro do clip, playbackRate),
   * interpolados linearmente. Quando presente, vale no lugar de `speed`.
   * `duration` é sempre tempo de TIMELINE; o trecho de origem consumido é a
   * integral da curva.
   */
  speedRamp: z
    .array(z.object({ u: z.number().min(0).max(1), rate: z.number().min(0.25).max(4) }))
    .min(2)
    .max(12)
    .optional(),
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
  /** Curva da entrada/saída: swift (cubic-bezier in-out), ease_out (suave, Ken Burns) ou spring (mola física, com leve overshoot). */
  easing: z.enum(["swift", "ease_out", "spring"]).default("swift"),
  /** Rastreamento: o foco acompanha o centro de massa do sujeito detectado, quadro a quadro. */
  follow: z.boolean().default(false),
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

/** Mídia de contexto (b-roll) por cima do vídeo falado; o áudio da fala continua. */
export const BrollClipSchema = z.object({
  ...clipBase,
  type: z.literal("broll"),
  assetId: z.string(),
  sourceStart: z.number().min(0).default(0),
  /** full: cobre o quadro. card: cartão na parte de cima, com o apresentador visível embaixo. */
  layout: z.enum(["full", "card"]).default("full"),
});
export type BrollClip = z.infer<typeof BrollClipSchema>;

/** Efeito sonoro posicionado à mão (ou pelo agente) num instante: o pico cai em `start`. */
export const SfxClipSchema = z.object({
  ...clipBase,
  type: z.literal("sfx"),
  sfx: z.string().describe("id do catálogo de efeitos (public/sfx)"),
  volume: z.number().min(0).max(2).default(1),
});
export type SfxClip = z.infer<typeof SfxClipSchema>;

/** Impacto de câmera: flash branco e/ou tremida curta, para pontuar um golpe ou corte. */
export const ImpactClipSchema = z.object({
  ...clipBase,
  type: z.literal("impact"),
  kind: z.enum(["flash", "shake", "both"]).default("both"),
  intensity: z.number().min(0.1).max(2).default(1),
});
export type ImpactClip = z.infer<typeof ImpactClipSchema>;

export const ClipSchema = z.discriminatedUnion("type", [
  MediaClipSchema,
  ZoomClipSchema,
  ComponentClipSchema,
  BrollClipSchema,
  SfxClipSchema,
  ImpactClipSchema,
]);
export type Clip = z.infer<typeof ClipSchema>;

/**
 * main    — vídeo principal; clips `media` livres, com lacunas permitidas (NLE)
 * fx      — zooms e impactos de câmera aplicados ao vídeo principal
 * overlay — componentes de motion design
 * broll   — mídia de contexto por cima do vídeo (criada ao inserir a primeira)
 * audio   — efeitos sonoros posicionados (criada ao inserir o primeiro)
 */
export const TrackKindSchema = z.enum(["main", "fx", "overlay", "broll", "audio"]);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const TrackSchema = z.object({
  id: z.string(),
  kind: TrackKindSchema,
  name: z.string(),
  clips: z.array(ClipSchema),
});
export type Track = z.infer<typeof TrackSchema>;

/** Estilos de legenda. Os três primeiros são os originais; os demais, os presets dinâmicos. */
export const CAPTION_PRESET_IDS = ["bold", "clean", "karaoke", "viral_pop", "karaoke_pill", "comic_bounce", "editorial_clean", "neon_subtitle", "minimal_cinema"] as const;
export type CaptionPreset = (typeof CAPTION_PRESET_IDS)[number];
export const CAPTION_PRESET_NAMES: Record<CaptionPreset, string> = {
  viral_pop: "Viral Pop",
  karaoke_pill: "Pílula karaokê",
  comic_bounce: "Comic Bounce",
  editorial_clean: "Editorial",
  neon_subtitle: "Neon",
  minimal_cinema: "Cinema discreto",
  karaoke: "Karaokê",
  bold: "Negrito",
  clean: "Limpa",
};

export const CaptionStyleSchema = z.object({
  preset: z.enum(CAPTION_PRESET_IDS).default("karaoke"),
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
  /**
   * Tarja de nome/cargo. DESLIGADA por padrão: só aparece quando o usuário
   * liga (1 clique) ou pede explicitamente ao agente.
   */
  showLowerThird: z.boolean().default(false),
  /**
   * Nomes, marcas e termos técnicos que a transcrição deve escrever do jeito
   * certo (ex.: "Dra. Ana Souza", "Hipertrofia Max", "CRM"). Vão como dica
   * para o transcritor em todo vídeo.
   */
  vocabulary: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;
export const defaultBrandKit = (): BrandKit => BrandKitSchema.parse({});

export const LOOK_IDS = ["none", "tactical_teal_orange", "bleach_bypass", "warm_cinematic", "clean_punch"] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const LOOK_NAMES: Record<LookId, string> = {
  none: "Sem tratamento",
  tactical_teal_orange: "Tactical Teal & Orange",
  bleach_bypass: "High-Contrast Bleach Bypass",
  warm_cinematic: "Warm Cinematic",
  clean_punch: "Clean Punch",
};

/** Tratamento visual do vídeo inteiro: grade de cor (LUT), vinheta e barras cinemáticas. */
export const LookSchema = z.object({
  grade: z.enum(LOOK_IDS).default("none"),
  intensity: z.number().min(0).max(1).default(1),
  /** Vinheta dinâmica: 0 desliga; respira com a energia da cena. */
  vignette: z.number().min(0).max(1).default(0),
  /** Altura de cada barra cinemática em fração do quadro (0 desliga; 0.1 ≈ 2.39:1 em 16:9). */
  letterbox: z.number().min(0).max(0.2).default(0),
});
export type Look = z.infer<typeof LookSchema>;

export const MUSIC_MOODS = ["none", "action", "ambient", "upbeat"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];
export const MUSIC_NAMES: Record<MusicMood, string> = { none: "Sem trilha", action: "Ação (pulso grave)", ambient: "Ambiente sutil", upbeat: "Animada" };

/** Trilha de fundo. `mood` usa a trilha gerada da casa; `assetId` usa um áudio do usuário. */
export const MusicSchema = z.object({
  mood: z.enum(MUSIC_MOODS).default("none"),
  assetId: z.string().optional(),
  volume: z.number().min(0).max(1.5).default(0.5),
  /** Auto-ducking: baixa a trilha em −14 dB sob a voz e devolve nas pausas. */
  duck: z.boolean().default(true),
});
export type Music = z.infer<typeof MusicSchema>;

/** Perfil de estilo extraído de um vídeo de referência (YouTube) para o Diretor de IA replicar. */
export const StyleReferenceProfileSchema = z.object({
  url: z.string().max(300),
  videoId: z.string().max(20),
  title: z.string().max(200).default(""),
  channel: z.string().max(120).default(""),
  durationSec: z.number().min(0).default(0),
  /** Ritmo: cortes por minuto estimados, velocidade da fala e duração média de plano. */
  pacing: z.object({
    cutsPerMin: z.number().min(0).max(120).default(0),
    wordsPerMin: z.number().min(0).max(400).default(0),
    avgShotSec: z.number().min(0).max(120).default(0),
    energy: z.enum(["baixa", "media", "alta"]).default("media"),
  }),
  /** Estrutura: capítulos/atos com o instante em que começam. */
  structure: z.array(z.object({ t: z.number().min(0), title: z.string().max(120) })).max(24).default([]),
  /** Como os cortes são feitos (jump cuts, cortes na batida, planos longos…). */
  cutStyle: z.string().max(300).default(""),
  palette: z.array(hex).max(6).default([]),
  typography: z.string().max(240).default(""),
  captions: z.string().max(240).default(""),
  genre: GenreSchema.optional(),
  /** Diretrizes no imperativo para o Diretor: o que replicar neste vídeo. */
  guidelines: z.array(z.string().max(240)).max(10).default([]),
  /** De onde veio cada parte: metadados, transcrição, análise visual da miniatura. */
  sources: z.array(z.string().max(40)).max(6).default([]),
});
export type StyleReferenceProfile = z.infer<typeof StyleReferenceProfileSchema>;

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
  /**
   * Acabamento automático, o que separa "cortado" de "finalizado":
   * - cutZoom: alterna um leve zoom a cada corte da fala, para o corte parecer
   *   troca de enquadramento e não um salto;
   * - voice: leva a voz ao volume padrão das redes (≈ −14 LUFS) com compressão leve.
   */
  finish: z.object({ cutZoom: z.boolean().default(true), voice: z.boolean().default(true) }).default({ cutZoom: true, voice: true }),
  /** Tratamento visual (grade, vinheta, letterbox). Projetos antigos: nenhum. */
  look: LookSchema.default(() => LookSchema.parse({})),
  /** Trilha de fundo com auto-ducking. */
  music: MusicSchema.default(() => MusicSchema.parse({})),
  /** Marcadores da timeline: pontos de referência com snapping. */
  markers: z.array(z.object({ id: z.string(), t: z.number().min(0), label: z.string().max(40).optional() })).default([]),
  /** Gênero editorial; ausente = ainda não classificado (ou herdado da análise do asset). */
  genre: GenreSchema.optional(),
  /** Referência de inspiração (YouTube) para o Diretor de IA. */
  styleReference: StyleReferenceProfileSchema.optional(),
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
