import { z } from "zod";
import {
  BrandKitSchema,
  CaptionStyleSchema,
  FORMATS,
  GenreSchema,
  LookSchema,
  MusicSchema,
  StyleReferenceProfileSchema,
  type Clip,
  type MediaClip,
  type Project,
  type TimeRange,
  type Word,
} from "./schema";
import {
  MIN_CLIP,
  clipEnd,
  contextAssets,
  findClip,
  getTrack,
  localTimeAt,
  mainClips,
  mediaSlice,
  newId,
  projectGenre,
  rampCurve,
  rateAverage,
  sourceEnd,
  sourceSpan,
  sourceTimeAt,
  normalizeRanges,
  projectDuration,
  r3,
  sortTrack,
  sourceRangesToTimeline,
  subjectAt,
  subjectFocus,
  timelineWord,
  timelineWords,
  wordCutRange,
} from "./timeline";
import { findRetakes } from "./retakes";
import { silencesFromWords, SILENCE_MODES } from "./silence";
import { timelineActionRanges, voiceRanges } from "./analysis";

/**
 * Operações: a única forma de alterar um projeto.
 * A UI (edição manual, 0 créditos) e o agente (tool call) falam a mesma língua,
 * então tudo que a IA faz é reproduzível, validável e desfazível.
 */

const RangeSchema = z.object({
  start: z.number().min(0).describe("início em segundos (tempo de timeline)"),
  end: z.number().min(0).describe("fim em segundos (tempo de timeline)"),
});

/**
 * Âncoras por palavra. Um id de palavra aponta para um instante do vídeo
 * BRUTO, que não muda com cortes: o core traduz para tempo de timeline na
 * hora de aplicar. É o que impede zooms e componentes de ficarem deslocados
 * (ripple shift) e torna a ordem das operações irrelevante.
 */
const atWord = z.string().describe("id da palavra em que começa (ex.: w42)");
/**
 * Âncora por tempo do vídeo BRUTO: para material sem fala (ação, b-roll,
 * demonstração), onde não há palavra para ancorar. Como o id de palavra, não
 * muda com cortes.
 */
const atSource = z.number().min(0).describe("instante no vídeo BRUTO (s) em que começa; para trechos sem fala. Alternativa a atWord");
const untilSource = z.number().min(0).describe("instante no vídeo BRUTO (s) em que termina; alternativa a duration/untilWord");
const anchor = {
  start: z.number().min(0).optional().describe("início em tempo de timeline; alternativa a atWord/atSource"),
  atWord: atWord.optional(),
  atSource: atSource.optional(),
};
const untilWord = z.string().describe("id da palavra em que termina, inclusive; alternativa a duration");
const WordSpanSchema = z.object({
  from: z.string().describe("id da primeira palavra a cortar"),
  to: z.string().describe("id da última palavra a cortar (inclusive); igual a from para cortar uma palavra só"),
});

const RemoveRanges = z
  .object({ op: z.literal("remove_ranges"), ranges: z.array(RangeSchema).min(1) })
  .describe(
    "Corta trechos da timeline e fecha o buraco (ripple) em todas as trilhas. Todas as faixas se referem à timeline ANTES desta operação.",
  );
const CutWords = z
  .object({ op: z.literal("cut_words"), cuts: z.array(WordSpanSchema).min(1) })
  .describe(
    "Corta trechos de fala por palavra e fecha o buraco (ripple). Cada corte remove de `from` a `to` inclusive e cai sempre no intervalo entre palavras. É a forma de tirar erros, repetições e trechos indesejados.",
  );
const RemoveRetakes = z
  .object({
    op: z.literal("remove_retakes"),
    minConfidence: z.enum(["alta", "media"]).default("alta").describe("alta = só erros quase certos; media inclui os duvidosos"),
  })
  .describe("Remove de forma determinística os takes ruins detectados na transcrição (retomadas, gaguejos, avisos de erro), mantendo o último take.");
const RemoveSilences = z
  .object({
    op: z.literal("remove_silences"),
    mode: z.enum(["aggressive", "natural", "dead"]).optional().describe("aggressive: corta toda pausa > 0,45 s (talking-head). natural: só > 0,8 s. dead: só pausas mortas > 1,5 s"),
    minSilence: z.number().min(0.15).optional().describe("pausa mínima (s) para cortar; nunca vale menos que 0,45 s"),
    padding: z.number().min(0).optional().describe("respiro extra (s) em cada lado da fala; o mínimo é sempre 150 ms antes e 220 ms depois da palavra"),
    preserveAction: z
      .enum(["auto", "always", "never"])
      .default("auto")
      .describe("auto: não corta silêncios com alta atividade visual, e em vídeo de ação não corta nada. always: Preservar Ação. never: corta só pelo áudio"),
    range: RangeSchema.optional().describe("limita a detecção a este trecho"),
    fromWord: z.string().optional().describe("limita a detecção: a partir desta palavra"),
    toWord: z.string().optional().describe("limita a detecção: até esta palavra"),
  })
  .describe("Detecta pausas entre palavras da transcrição e as remove de forma determinística, preservando sílabas (pré/pós-roll) e cenas de ação.");
const Split = z
  .object({ op: z.literal("split"), time: z.number().min(0) })
  .describe("Divide o clip de vídeo principal no tempo indicado.");
const DeleteClip = z
  .object({
    op: z.literal("delete_clip"),
    clipId: z.string(),
    ripple: z.boolean().default(true).describe("trilha principal: true fecha o buraco (ripple delete); false deixa a lacuna"),
  })
  .describe("Remove um clip. Na trilha principal o buraco é fechado (ripple), a não ser com ripple: false.");
const MoveClip = z
  .object({
    op: z.literal("move_clip"),
    clipId: z.string(),
    start: z.number().min(0).describe("novo início em tempo de timeline"),
    mode: z.enum(["auto", "insert"]).default("auto").describe("auto: posição livre (cria lacunas); se cair sobre outro clip, encaixa no ponto de corte mais próximo. insert: sempre abre espaço empurrando o que vem depois"),
  })
  .describe("Move um clip na timeline. Na trilha principal o clip é livre: pode deixar lacunas ou ser encaixado entre dois clips (ripple), sem sobrescrever nada.");
const InsertClip = z
  .object({
    op: z.literal("insert_clip"),
    assetId: z.string(),
    at: z.number().min(0).describe("onde soltar, em tempo de timeline"),
    mode: z
      .enum(["auto", "insert", "overwrite"])
      .default("auto")
      .describe("auto: sobre um clip → insere no ponto de corte mais próximo empurrando o resto; numa lacuna → encaixa (apara se não couber). insert: sempre empurra. overwrite: substitui o que estiver embaixo"),
    sourceStart: z.number().min(0).default(0),
    duration: z.number().positive().optional(),
  })
  .describe("Põe uma mídia na trilha principal: entre dois clips (insert/ripple), numa lacuna, ou sobrescrevendo.");
const SetSpeed = z
  .object({ op: z.literal("set_speed"), clipId: z.string(), speed: z.number().min(0.25).max(4) })
  .describe("Velocidade constante de um clip de vídeo (1 = normal). O resto da timeline acompanha a nova duração.");
const SpeedRamp = z
  .object({
    op: z.literal("speed_ramp"),
    ...anchor,
    duration: z.number().positive().optional().describe("duração do trecho ANTES da rampa, em segundos"),
    untilWord: untilWord.optional(),
    untilSource: untilSource.optional(),
    rate: z.number().min(0.25).max(4).describe("0.4–0.6: câmera lenta dramática (tensão, preparo, impacto). 1.4–2.0: aceleração (deslocamentos, transições)"),
    ease: z.number().min(0.05).max(0.45).default(0.25).describe("fração do trecho gasta em cada transição de velocidade (entrada e saída suaves, inclusive no áudio)"),
  })
  .describe("Rampa de velocidade num trecho do vídeo principal: entra de 1x, segura em `rate` e volta a 1x, com transição suave. Aplique as rampas ANTES de zooms e componentes do mesmo trecho.");
const AddSfx = z
  .object({
    op: z.literal("add_sfx"),
    sfx: z.string().describe("id do catálogo de efeitos sonoros"),
    ...anchor,
    volume: z.number().min(0).max(2).default(1),
  })
  .describe("Dispara um efeito sonoro com o pico exatamente no instante indicado (pico de ação, corte, impacto).");
const AddImpact = z
  .object({
    op: z.literal("add_impact"),
    ...anchor,
    kind: z.enum(["flash", "shake", "both"]).default("both"),
    intensity: z.number().min(0.1).max(2).default(1),
    duration: z.number().min(0.15).max(1.5).default(0.45),
  })
  .describe("Impacto de câmera (flash branco e/ou tremida curta) num golpe, corte ou batida. No máximo um a cada 4 s.");
const SetLook = z
  .object({ op: z.literal("set_look"), look: LookSchema.partial() })
  .describe("Tratamento visual do vídeo inteiro: grade de cor (LUT), intensidade, vinheta dinâmica e barras cinemáticas (letterbox).");
const SetMusic = z
  .object({ op: z.literal("set_music"), music: MusicSchema.partial() })
  .describe("Trilha de fundo: clima (action, ambient, upbeat ou none), volume e auto-ducking sob a voz.");
const AddMarker = z.object({ op: z.literal("add_marker"), time: z.number().min(0), label: z.string().max(40).optional() }).describe("Marcador na timeline (ponto de snapping).");
const RemoveMarker = z.object({ op: z.literal("remove_marker"), markerId: z.string() }).describe("Remove um marcador.");
const CutSource = z
  .object({
    op: z.literal("cut_source"),
    cuts: z.array(z.object({ from: z.number().min(0), to: z.number().min(0) }).describe("trecho do vídeo BRUTO, em segundos")).min(1),
  })
  .describe("Corta trechos pelo tempo do vídeo BRUTO e fecha o buraco. Para material sem fala (tempo morto, câmera balançando), onde não há palavras para cut_words.");
const SetGenre = z.object({ op: z.literal("set_genre"), genre: GenreSchema.nullable() }).describe("Define o gênero editorial do vídeo (null volta ao detectado).");
const SetStyleReference = z
  .object({ op: z.literal("set_style_reference"), profile: StyleReferenceProfileSchema.nullable() })
  .describe("Guarda (ou remove) a referência de inspiração do projeto.");
const TrimClip = z
  .object({
    op: z.literal("trim_clip"),
    clipId: z.string(),
    sourceStart: z.number().min(0).optional(),
    sourceEnd: z.number().min(0).optional(),
  })
  .describe(
    "Ajusta o ponto de entrada/saída (tempo de ORIGEM) de um clip de vídeo principal, encurtando ou recuperando material. O restante da timeline acompanha.",
  );
const zoomFields = {
  scale: z.number().min(1).max(4).default(1.25),
  x: z.number().min(0).max(1).optional().describe("foco horizontal; omita para centrar no rosto do apresentador"),
  y: z.number().min(0).max(1).optional().describe("foco vertical; omita para centrar no rosto do apresentador"),
  ease: z.number().min(0).default(0.25),
  mode: z
    .enum(["hold", "creep"])
    .default("hold")
    .describe("hold: entra, segura e sai. creep: avanço lento e contínuo de 1 até scale durante o clip inteiro (use scale 1.12–1.18, 3–6 s)"),
  panX: z
    .number()
    .min(-0.5)
    .max(0.5)
    .default(0)
    .describe("pan lateral em fração da largura. Positivo leva o apresentador para a DIREITA (abre espaço à esquerda); negativo para a esquerda. Exige scale ≥ 1.2; típico ±0.12 com scale 1.3"),
  panY: z.number().min(-0.5).max(0.5).default(0),
  easing: z.enum(["swift", "ease_out", "spring"]).default("swift").describe("curva do movimento: swift (decidido), ease_out (suave, documentário), spring (mola física, para punch-ins de impacto; use com ease 0.25–0.4)"),
};
const AddZoom = z
  .object({
    op: z.literal("add_zoom"),
    ...anchor,
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    untilSource: untilSource.optional(),
    ...zoomFields,
  })
  .describe("Zoom no vídeo principal. ease=0 gera punch-in seco; ease>0 gera zoom suave.");
const componentParams = z
  .record(z.string(), z.unknown())
  .describe(
    "params do componente. Onde o componente aceita um instante `at` (segundos desde o início dele), você pode mandar `atWord` com o id da palavra: o instante é calculado na aplicação.",
  );
const ClipStyle = z
  .object({
    dx: z.number().min(-1).max(1),
    dy: z.number().min(-1).max(1),
    scale: z.number().min(0.3).max(3),
    primaryColor: z.string().nullable(),
    textColor: z.string().nullable(),
    backgroundColor: z.string().nullable(),
    fontPair: z.string().nullable(),
  })
  .partial()
  .describe("ajustes visuais do clip: posição, tamanho, cores e fonte. null volta ao Brand Kit");
const AddComponent = z
  .object({
    op: z.literal("add_component"),
    component: z.string().describe("id de um componente do catálogo"),
    ...anchor,
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    untilSource: untilSource.optional(),
    params: componentParams,
  })
  .describe("Insere um componente de motion design do catálogo sobre o vídeo.");
const AddBroll = z
  .object({
    op: z.literal("add_broll"),
    assetId: z.string().describe("id de uma mídia de contexto listada no projeto"),
    ...anchor,
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    untilSource: untilSource.optional(),
    sourceStart: z.number().min(0).default(0).describe("de que segundo da mídia começar"),
    layout: z.enum(["full", "card"]).default("full").describe("full: cobre o quadro inteiro. card: cartão na metade de cima, apresentador visível embaixo"),
  })
  .describe("Põe uma mídia de contexto (b-roll) por cima do vídeo num trecho; a fala continua tocando. Use 2 a 5 s, onde a fala se refere ao que a mídia mostra.");
const UpdateClip = z
  .object({
    op: z.literal("update_clip"),
    clipId: z.string(),
    start: z.number().min(0).optional(),
    atWord: atWord.optional(),
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    volume: z.number().min(0).max(2).optional(),
    speed: z.number().min(0.25).max(4).optional().describe("velocidade constante de um clip de vídeo"),
    kind: z.enum(["flash", "shake", "both"]).optional(),
    intensity: z.number().min(0.1).max(2).optional(),
    sfx: z.string().optional(),
    scale: z.number().min(1).max(4).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    ease: z.number().min(0).optional(),
    mode: z.enum(["hold", "creep"]).optional(),
    easing: z.enum(["swift", "ease_out", "spring"]).optional(),
    panX: z.number().min(-0.5).max(0.5).optional(),
    panY: z.number().min(-0.5).max(0.5).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    style: ClipStyle.optional(),
    layout: z.enum(["full", "card"]).optional(),
    sourceStart: z.number().min(0).optional(),
  })
  .describe(
    "Altera um clip existente. Início/duração valem para zoom e componentes; params é mesclado aos params atuais do componente; volume vale para vídeo.",
  );
const SetCaptions = z
  .object({
    op: z.literal("set_captions"),
    enabled: z.boolean().optional(),
    style: CaptionStyleSchema.partial().optional(),
  })
  .describe("Liga/desliga e estiliza as legendas automáticas (geradas a partir da transcrição).");
const EditWord = z
  .object({
    op: z.literal("edit_word"),
    wordId: z.string(),
    text: z.string().describe("novo texto; string vazia oculta a palavra da legenda"),
  })
  .describe("Corrige o texto de uma palavra da transcrição/legenda.");
const EditCaption = z
  .object({
    op: z.literal("edit_caption"),
    wordIds: z.array(z.string()).min(1).describe("palavras que formam a legenda, em ordem"),
    text: z.string().optional().describe("novo texto da legenda inteira"),
    hidden: z.boolean().optional().describe("true tira esta legenda do vídeo (a fala continua)"),
    shift: z.number().min(-5).max(5).optional().describe("adianta (−) ou atrasa (+) a legenda, em segundos"),
  })
  .describe("Edita uma legenda na timeline: reescreve, esconde ou desloca no tempo.");
const SetBrand = z
  .object({ op: z.literal("set_brand"), brand: BrandKitSchema.partial() })
  .describe("Altera o Brand Kit do projeto (cores, par de fontes, nome e credencial).");

const SetFormat = z
  .object({
    op: z.literal("set_format"),
    aspectRatio: z.enum(["9:16", "16:9"]).optional(),
    framing: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).partial().optional(),
    sfx: z.object({ enabled: z.boolean(), volume: z.number().min(0).max(2) }).partial().optional(),
    finish: z.object({ cutZoom: z.boolean(), voice: z.boolean() }).partial().optional(),
  })
  .describe("Muda o formato do quadro (vertical/horizontal), o reenquadramento do vídeo de origem e os efeitos sonoros.");

export const OperationSchema = z.discriminatedUnion("op", [
  RemoveRanges,
  CutWords,
  RemoveRetakes,
  RemoveSilences,
  Split,
  DeleteClip,
  TrimClip,
  AddZoom,
  AddComponent,
  AddBroll,
  UpdateClip,
  SetCaptions,
  EditWord,
  EditCaption,
  SetBrand,
  SetFormat,
  MoveClip,
  InsertClip,
  SetSpeed,
  SpeedRamp,
  AddSfx,
  AddImpact,
  SetLook,
  SetMusic,
  AddMarker,
  RemoveMarker,
  CutSource,
  SetGenre,
  SetStyleReference,
]);
export type Operation = z.infer<typeof OperationSchema>;
export type OperationInput = z.input<typeof OperationSchema>;

/**
 * Vocabulário do agente: as mesmas operações, só com referências estáveis
 * (palavra/clip). Tempo de timeline fica de fora — ele muda a cada corte e é
 * a origem dos erros de sincronia.
 */
const anchored = (o: { atWord?: string; atSource?: number }) => o.atWord !== undefined || o.atSource !== undefined;
const NEEDS_ANCHOR = "informe atWord (id de palavra) ou atSource (segundos do vídeo bruto)";
export const AgentOperationSchema = z.discriminatedUnion("op", [
  CutWords,
  RemoveRetakes,
  RemoveSilences.omit({ range: true }),
  CutSource,
  AddZoom.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  AddComponent.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  AddBroll.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  SpeedRamp.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  AddSfx.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  AddImpact.omit({ start: true }).refine(anchored, NEEDS_ANCHOR),
  SetLook,
  SetMusic,
  UpdateClip.omit({ start: true, style: true }),
  DeleteClip,
  SetCaptions,
  EditWord,
]);

export class OperationError extends Error {
  constructor(
    message: string,
    public index: number,
  ) {
    super(message);
  }
}

export type ApplyContext = {
  /** Valida/normaliza params de um componente contra o catálogo. Deve lançar se inválido. */
  validateComponent?: (component: string, params: Record<string, unknown>, frame?: { vertical: boolean }) => Record<string, unknown>;
  /** Confere um id de efeito sonoro contra o catálogo. Deve lançar se não existe. */
  validateSfx?: (sfx: string) => void;
};

export type ApplyResult = { project: Project; log: string[] };

const fmt = (s: number) => `${r3(s)}s`;

/** Aplica operações em ordem; cada uma enxerga o resultado da anterior. Não muta a entrada. */
export function applyOperations(
  project: Project,
  ops: OperationInput[],
  ctx: ApplyContext = {},
): ApplyResult {
  let current = structuredClone(project);
  const log: string[] = [];
  ops.forEach((raw, index) => {
    const parsed = OperationSchema.safeParse(raw);
    if (!parsed.success)
      throw new OperationError(
        `Operação ${index} inválida: ${z.prettifyError(parsed.error)}`,
        index,
      );
    try {
      // Cada operação trabalha numa cópia: se falhar, o estado anterior fica intacto.
      const draft = structuredClone(current);
      log.push(applyOne(draft, parsed.data, ctx));
      for (const t of draft.tracks) sortTrack(t);
      current = draft;
    } catch (e) {
      if (e instanceof OperationError) throw e;
      throw new OperationError(
        `Operação ${index} (${parsed.data.op}) falhou: ${(e as Error).message}`,
        index,
      );
    }
  });
  return { project: current, log };
}

function applyOne(p: Project, op: Operation, ctx: ApplyContext): string {
  switch (op.op) {
    case "remove_ranges": {
      const ranges = normalizeRanges(op.ranges, projectDuration(p));
      if (!ranges.length) throw new Error("nenhuma faixa válida dentro da timeline");
      removeRanges(p, ranges);
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      return `${ranges.length} corte(s), ${fmt(total)} removidos`;
    }
    case "cut_words":
      return cutWords(p, op.cuts);
    case "remove_retakes": {
      const words = timelineWords(p);
      if (!words.length) {
        // Vídeo transcrito e sem fala (ação, b-roll): não há take para revisar, e isso não é erro.
        if (Object.values(p.assets).some((a) => a.transcript)) return "sem fala: nenhum take para revisar";
        throw new Error("o vídeo ainda não tem transcrição; transcreva antes de remover erros de gravação");
      }
      const takes = findRetakes(words).filter((r) => op.minConfidence === "media" || r.confidence === "alta");
      if (!takes.length) return "nenhum take ruim encontrado";
      return cutWords(p, takes).replace("corte(s)", "take(s) ruim(ns) cortado(s)");
    }
    case "remove_silences": {
      const words = timelineWords(p);
      // Sem transcrição, a voz detectada no áudio (VAD) faz o papel das palavras.
      const spoken: { start: number; end: number }[] = words.length ? words : voiceRanges(p);
      if (!spoken.length)
        throw new Error("o vídeo ainda não tem transcrição; transcreva antes de remover silêncios");
      const action = projectGenre(p) === "action_cinematic";
      if (op.preserveAction === "auto" && action)
        return "vídeo de ação: as pausas sem fala fazem parte da cena e foram preservadas";
      // Silêncio com alta atividade visual não é tempo morto: fica.
      const protect = op.preserveAction === "never" ? [] : timelineActionRanges(p, op.preserveAction === "always" ? 0.25 : 0.5);
      let ranges = silencesFromWords(spoken, mainEnd(p), { ...op, protect });
      if (op.range || op.fromWord || op.toWord) {
        const start = op.fromWord ? timelineWord(p, op.fromWord, words).start : (op.range?.start ?? 0);
        const end = op.toWord ? timelineWord(p, op.toWord, words).end : (op.range?.end ?? Infinity);
        ranges = normalizeRanges(
          ranges.map((r) => ({ start: Math.max(r.start, start), end: Math.min(r.end, end) })),
        );
      }
      // Lacunas deixadas de propósito na trilha principal não são "silêncio da fala".
      ranges = ranges.filter((r) => mainClips(p).some((c) => c.start < r.end && clipEnd(c) > r.start));
      if (!ranges.length) return "nenhum silêncio acima do limite encontrado";
      removeRanges(p, ranges);
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      return `${ranges.length} silêncio(s) removidos, ${fmt(total)} a menos (${SILENCE_MODES[op.mode ?? "aggressive"].name})`;
    }
    case "split": {
      if (!splitMainAt(p, op.time)) throw new Error(`não há clip para dividir em ${fmt(op.time)}`);
      return `clip dividido em ${fmt(op.time)}`;
    }
    case "delete_clip": {
      const found = mustFind(p, op.clipId);
      if (found.track.kind === "main" && op.ripple) {
        removeRanges(p, [{ start: found.clip.start, end: clipEnd(found.clip) }]);
        return `clip ${op.clipId} removido e buraco fechado (ripple)`;
      } else {
        found.track.clips = found.track.clips.filter((c) => c.id !== op.clipId);
      }
      return `clip ${op.clipId} removido`;
    }
    case "trim_clip": {
      const { clip } = mustFind(p, op.clipId);
      if (clip.type !== "media") throw new Error("trim_clip só vale para clips de vídeo; use update_clip");
      const asset = p.assets[clip.assetId];
      if (!asset) throw new Error("asset do clip não encontrado");
      if (hasSpeedClip(clip)) {
        // Clip com velocidade: a curva é mantida e a duração segue o novo trecho de origem.
        const ss = r3(Math.min(Math.max(op.sourceStart ?? clip.sourceStart, 0), asset.duration - MIN_CLIP));
        const se = r3(Math.min(Math.max(op.sourceEnd ?? sourceEnd(clip), ss + MIN_CLIP), asset.duration));
        const oldEnd = clipEnd(clip);
        clip.sourceStart = ss;
        clip.duration = r3((se - ss) / rateAverage(clip));
        shiftFrom(p, oldEnd, clipEnd(clip) - oldEnd, clip.id);
        return `clip ajustado para origem ${fmt(ss)}–${fmt(se)}`;
      }
      const oldSS = clip.sourceStart;
      const oldSE = r3(clip.sourceStart + clip.duration);
      const newSS = r3(Math.min(Math.max(op.sourceStart ?? oldSS, 0), asset.duration - MIN_CLIP));
      const newSE = r3(Math.min(Math.max(op.sourceEnd ?? oldSE, newSS + MIN_CLIP), asset.duration));
      // Fim primeiro, para os tempos do início continuarem válidos.
      if (newSE < oldSE) {
        removeRanges(p, [{ start: clipEnd(clip) - (oldSE - newSE), end: clipEnd(clip) }]);
      } else if (newSE > oldSE) {
        insertTime(p, clipEnd(clip), newSE - oldSE, clip.id);
        mustFindMedia(p, clip.id).duration = r3(clip.duration + newSE - oldSE);
      }
      if (newSS > oldSS) {
        removeRanges(p, [{ start: clip.start, end: clip.start + (newSS - oldSS) }]);
      } else if (newSS < oldSS) {
        const d = oldSS - newSS;
        const c = mustFindMedia(p, clip.id);
        insertTime(p, c.start, d, c.id);
        c.sourceStart = newSS;
        c.duration = r3(c.duration + d);
      }
      return `clip ajustado para origem ${fmt(newSS)}–${fmt(newSE)}`;
    }
    case "add_zoom": {
      const span = resolveSpan(p, op);
      const { start, duration } = fitToMain(p, span.start, span.duration);
      // Sem foco explícito, o zoom fecha no rosto (quando o vídeo já foi analisado).
      const subject = op.x === undefined || op.y === undefined ? subjectAt(p, start + duration / 2) : null;
      const face = subject ? subjectFocus(subject) : null;
      const zoomId = newId("zoom");
      getTrack(p, "fx").clips.push({
        id: zoomId,
        type: "zoom",
        start,
        duration,
        scale: op.scale,
        x: op.x ?? face?.x ?? 0.5,
        y: op.y ?? face?.y ?? 0.4,
        ease: Math.min(op.ease, duration / 2),
        mode: op.mode,
        panX: op.panX,
        panY: op.panY,
        easing: op.easing,
        // Sem foco explícito e com o sujeito medido: o zoom rastreia o sujeito enquanto durar.
        follow: !!face,
      });
      return `zoom ${op.scale}x (${zoomId}) em ${fmt(start)} por ${fmt(duration)}`;
    }
    case "add_component": {
      const span = resolveSpan(p, op);
      const { start, duration } = fitToMain(p, span.start, span.duration);
      const timed = resolveTimedParams(p, op.params, start, duration);
      const params = ctx.validateComponent ? ctx.validateComponent(op.component, timed, { vertical: p.height > p.width }) : timed;
      const clip: Clip = {
        id: newId("cmp"),
        type: "component",
        component: op.component,
        start,
        duration,
        params,
      };
      overlayTrackFor(p, start, duration).clips.push(clip);
      return `componente ${op.component} (${clip.id}) em ${fmt(start)} por ${fmt(duration)}`;
    }
    case "add_broll": {
      const asset = p.assets[op.assetId];
      // Qualquer vídeo ou imagem do projeto pode ir para a trilha de cima (overlay), sem mexer no áudio principal.
      if (!asset || asset.kind === "audio") throw new Error(`mídia de contexto ${op.assetId} não existe. Disponíveis: ${contextAssets(p).map((a) => a.id).join(", ") || "nenhuma"}`);
      const still = asset.kind === "image";
      const span = resolveSpan(p, { ...op, duration: op.duration ?? (op.untilWord ? undefined : Math.min(4, still ? 4 : asset.duration)) });
      const sourceStart = still ? 0 : Math.min(op.sourceStart, Math.max(0, asset.duration - MIN_CLIP));
      // Vídeo de contexto não se repete: a duração para no fim do material.
      const fit = fitToMain(p, span.start, still ? span.duration : Math.min(span.duration, asset.duration - sourceStart));
      const id = newId("broll");
      brollTrackFor(p, fit.start, fit.duration).clips.push({ id, type: "broll", assetId: asset.id, start: fit.start, duration: fit.duration, sourceStart: r3(sourceStart), layout: op.layout });
      return `mídia de contexto "${asset.name}" (${id}) em ${fmt(fit.start)} por ${fmt(fit.duration)}`;
    }
    case "update_clip": {
      const { clip } = mustFind(p, op.clipId);
      if (clip.type === "media") {
        if (op.volume === undefined && op.speed === undefined)
          throw new Error("em clips de vídeo só o volume e a velocidade são alteráveis aqui; use trim_clip/split/move_clip");
        if (op.volume !== undefined) clip.volume = op.volume;
        if (op.speed !== undefined) setClipSpeed(p, clip, { speed: op.speed });
        return `clip ${clip.id} atualizado${op.volume !== undefined ? ` (volume ${op.volume})` : ""}${op.speed !== undefined ? ` (velocidade ${op.speed}x)` : ""}`;
      }
      if (clip.type === "sfx") {
        if (op.sfx) {
          ctx.validateSfx?.(op.sfx);
          clip.sfx = op.sfx;
        }
        if (op.volume !== undefined) clip.volume = op.volume;
        if (op.start !== undefined) clip.start = r3(op.start);
        return `efeito sonoro ${clip.id} atualizado`;
      }
      if (op.start !== undefined || op.atWord || op.duration !== undefined || op.untilWord) {
        const span = resolveSpan(p, { start: op.start ?? (op.atWord ? undefined : clip.start), atWord: op.atWord, duration: op.duration ?? (op.untilWord ? undefined : clip.duration), untilWord: op.untilWord });
        clip.start = span.start;
        clip.duration = span.duration;
      }
      if (clip.type === "broll") {
        const asset = p.assets[clip.assetId];
        if (op.layout) clip.layout = op.layout;
        if (op.sourceStart !== undefined) clip.sourceStart = r3(op.sourceStart);
        if (asset && asset.kind !== "image") {
          clip.sourceStart = r3(Math.min(clip.sourceStart, Math.max(0, asset.duration - MIN_CLIP)));
          clip.duration = r3(Math.min(clip.duration, asset.duration - clip.sourceStart));
        }
      } else if (clip.type === "impact") {
        if (op.kind) clip.kind = op.kind;
        if (op.intensity !== undefined) clip.intensity = op.intensity;
      } else if (clip.type === "zoom") {
        if (op.scale !== undefined) clip.scale = op.scale;
        if (op.x !== undefined) clip.x = op.x;
        if (op.y !== undefined) clip.y = op.y;
        // Foco escolhido à mão desliga o rastreamento.
        if (op.x !== undefined || op.y !== undefined) clip.follow = false;
        if (op.easing !== undefined) clip.easing = op.easing;
        if (op.ease !== undefined) clip.ease = op.ease;
        if (op.mode !== undefined) clip.mode = op.mode;
        if (op.panX !== undefined) clip.panX = op.panX;
        if (op.panY !== undefined) clip.panY = op.panY;
        clip.ease = Math.min(clip.ease, clip.duration / 2);
      } else if (clip.type === "component") {
        if (op.params) {
          const merged = { ...clip.params, ...resolveTimedParams(p, op.params, clip.start, clip.duration) };
          clip.params = ctx.validateComponent ? ctx.validateComponent(clip.component, merged, { vertical: p.height > p.width }) : merged;
        }
        if (op.style) {
          const next: Record<string, unknown> = { dx: 0, dy: 0, scale: 1, ...clip.style };
          for (const [k, v] of Object.entries(op.style)) {
            if (v === null) delete next[k];
            else if (v !== undefined) next[k] = v;
          }
          clip.style = next as typeof clip.style;
        }
      }
      return `clip ${clip.id} atualizado`;
    }
    case "set_captions": {
      if (op.enabled !== undefined) p.captions.enabled = op.enabled;
      if (op.style) {
        const merged = { ...p.captions.style, ...op.style };
        // Escolher topo/centro/base desfaz a posição arrastada à mão.
        if (op.style.position && op.style.y === undefined) delete merged.y;
        p.captions.style = CaptionStyleSchema.parse(merged);
      }
      return `legendas ${p.captions.enabled ? "ligadas" : "desligadas"}`;
    }
    case "set_format": {
      if (op.aspectRatio) {
        p.aspectRatio = op.aspectRatio;
        p.width = FORMATS[op.aspectRatio].width;
        p.height = FORMATS[op.aspectRatio].height;
      }
      if (op.framing) p.framing = { ...p.framing, ...op.framing };
      if (op.sfx) p.sfx = { ...p.sfx, ...op.sfx };
      if (op.finish) p.finish = { ...p.finish, ...op.finish };
      return `formato ${p.aspectRatio} (${p.width}x${p.height})`;
    }
    case "move_clip": {
      const { track, clip } = mustFind(p, op.clipId);
      if (track.kind !== "main" || clip.type !== "media") {
        clip.start = r3(op.start);
        return `clip ${clip.id} movido para ${fmt(op.start)}`;
      }
      return moveMainClip(p, clip, op.start, op.mode);
    }
    case "insert_clip":
      return insertMainClip(p, op);
    case "set_speed": {
      const clip = mustFindMedia(p, op.clipId);
      setClipSpeed(p, clip, { speed: op.speed });
      return `velocidade do clip ${clip.id} = ${op.speed}x (${fmt(clip.duration)})`;
    }
    case "speed_ramp": {
      const span = resolveSpan(p, op);
      const end = r3(span.start + span.duration);
      splitMainAt(p, span.start);
      splitMainAt(p, end);
      // Do fim para o começo: mudar a duração de um trecho não desloca os anteriores.
      const targets = mainClips(p)
        .filter((c) => c.start >= span.start - 0.002 && clipEnd(c) <= end + 0.002)
        .sort((a, b) => b.start - a.start);
      if (!targets.length) throw new Error(`não há vídeo na trilha principal entre ${fmt(span.start)} e ${fmt(end)}`);
      const curve = rampCurve(op.rate, op.ease);
      targets.forEach((c, i) => {
        const last = i === 0;
        const first = i === targets.length - 1;
        // Um trecho só: entra, segura e sai. Vários (há cortes no meio): a entrada fica no primeiro e a saída no último.
        if (first && last) setClipSpeed(p, c, { speedRamp: curve });
        else if (first) setClipSpeed(p, c, { speedRamp: [curve[0]!, curve[1]!, { u: 1, rate: op.rate }] });
        else if (last) setClipSpeed(p, c, { speedRamp: [{ u: 0, rate: op.rate }, curve[2]!, curve[3]!] });
        else setClipSpeed(p, c, { speed: op.rate });
      });
      const after = targets.reduce((s, c) => s + c.duration, 0);
      return `rampa de velocidade ${op.rate}x (${op.rate < 1 ? "câmera lenta" : "aceleração"}) em ${fmt(span.start)}: ${fmt(span.duration)} → ${fmt(after)}`;
    }
    case "add_sfx": {
      ctx.validateSfx?.(op.sfx);
      const start = resolveStart(p, op);
      const id = newId("sfx");
      audioTrack(p).clips.push({ id, type: "sfx", sfx: op.sfx, start, duration: 0.6, volume: op.volume });
      return `efeito sonoro ${op.sfx} (${id}) em ${fmt(start)}`;
    }
    case "add_impact": {
      const start = resolveStart(p, op);
      const id = newId("imp");
      getTrack(p, "fx").clips.push({ id, type: "impact", start, duration: op.duration, kind: op.kind, intensity: op.intensity });
      return `impacto de câmera ${op.kind} (${id}) em ${fmt(start)}`;
    }
    case "set_look": {
      p.look = LookSchema.parse({ ...p.look, ...op.look });
      return `tratamento visual: ${p.look.grade}${p.look.vignette ? `, vinheta ${p.look.vignette}` : ""}${p.look.letterbox ? `, letterbox ${p.look.letterbox}` : ""}`;
    }
    case "set_music": {
      if (op.music.assetId && p.assets[op.music.assetId]?.kind !== "audio" && p.assets[op.music.assetId]?.kind !== "video") throw new Error(`áudio ${op.music.assetId} não existe no projeto`);
      p.music = MusicSchema.parse({ ...p.music, ...op.music });
      return `trilha de fundo: ${p.music.assetId ?? p.music.mood}${p.music.duck ? " com ducking sob a voz" : ""}`;
    }
    case "add_marker": {
      p.markers.push({ id: newId("mk"), t: r3(op.time), ...(op.label ? { label: op.label } : {}) });
      p.markers.sort((a, b) => a.t - b.t);
      return `marcador em ${fmt(op.time)}`;
    }
    case "remove_marker": {
      p.markers = p.markers.filter((m) => m.id !== op.markerId);
      return "marcador removido";
    }
    case "cut_source": {
      const assetId = primaryAssetId(p);
      if (!assetId) throw new Error("não há vídeo na trilha principal");
      const ranges = normalizeRanges(sourceRangesToTimeline(p, assetId, op.cuts.map((c) => ({ start: Math.min(c.from, c.to), end: Math.max(c.from, c.to) }))), projectDuration(p));
      if (!ranges.length) return "nada a cortar: esses trechos já não estão na timeline";
      removeRanges(p, ranges);
      return `${ranges.length} corte(s) por tempo de origem, ${fmt(ranges.reduce((s, r) => s + r.end - r.start, 0))} removidos`;
    }
    case "set_genre": {
      if (op.genre) p.genre = op.genre;
      else delete p.genre;
      return `gênero: ${projectGenre(p) ?? "não classificado"}`;
    }
    case "set_style_reference": {
      if (op.profile) p.styleReference = op.profile;
      else delete p.styleReference;
      return op.profile ? `referência de estilo: ${op.profile.title || op.profile.videoId}` : "referência de estilo removida";
    }
    case "set_brand": {
      p.brand = BrandKitSchema.parse({ ...p.brand, ...op.brand });
      return "brand kit atualizado";
    }
    case "edit_caption": {
      const found: Word[] = [];
      for (const id of op.wordIds) {
        let hit: Word | undefined;
        for (const asset of Object.values(p.assets)) hit ??= asset.transcript?.words.find((w) => w.id === id);
        if (!hit) throw new Error(`palavra ${id} não encontrada`);
        found.push(hit);
      }
      if (op.text !== undefined) {
        // Redistribui o texto novo pelas palavras: o que sobra fica na última; o que falta esvazia.
        const tokens = op.text.trim().split(/\s+/).filter(Boolean);
        found.forEach((w, i) => {
          w.text = i < found.length - 1 ? (tokens[i] ?? "") : tokens.slice(i).join(" ");
        });
      }
      for (const w of found) {
        if (op.hidden !== undefined) {
          if (op.hidden) w.hidden = true;
          else delete w.hidden;
        }
        if (op.shift !== undefined) {
          if (Math.abs(op.shift) < 0.005) delete w.shift;
          else w.shift = r3(op.shift);
        }
      }
      return op.hidden ? "legenda removida" : "legenda atualizada";
    }
    case "edit_word": {
      for (const asset of Object.values(p.assets)) {
        const w = asset.transcript?.words.find((w) => w.id === op.wordId);
        if (w) {
          w.text = op.text;
          return `palavra ${op.wordId} → "${op.text}"`;
        }
      }
      throw new Error(`palavra ${op.wordId} não encontrada`);
    }
  }
}

/** Corta faixas de palavras: traduz para tempo de origem e daí para a timeline atual. */
function cutWords(p: Project, cuts: { from: string; to: string }[]): string {
  const ranges: TimeRange[] = [];
  const texts: string[] = [];
  for (const cut of cuts) {
    const { assetId, range, text } = wordCutRange(p, cut.from, cut.to);
    const onTimeline = sourceRangesToTimeline(p, assetId, [range]);
    // Trecho já cortado antes: nada a fazer, sem erro (a operação é idempotente).
    if (!onTimeline.length) continue;
    ranges.push(...onTimeline);
    texts.push(`"${text.length > 60 ? `${text.slice(0, 57)}…` : text}"`);
  }
  const merged = normalizeRanges(ranges, projectDuration(p));
  if (!merged.length) return "nada a cortar: esses trechos já não estão na timeline";
  removeRanges(p, merged);
  const total = merged.reduce((s, r) => s + r.end - r.start, 0);
  return `${texts.length} corte(s), ${fmt(total)} removidos: ${texts.join(", ")}`;
}

/** Início e duração em tempo de timeline a partir de tempo explícito ou de âncoras por palavra. */
function resolveSpan(
  p: Project,
  op: { start?: number; atWord?: string; atSource?: number; duration?: number; untilWord?: string; untilSource?: number },
): { start: number; duration: number } {
  const words = op.atWord || op.untilWord ? timelineWords(p) : [];
  const start = op.atWord ? timelineWord(p, op.atWord, words).start : op.atSource !== undefined ? sourceToTimeline(p, op.atSource) : op.start;
  if (start === undefined) throw new Error("informe atWord ou atSource (ou start)");
  const duration = op.untilWord ? timelineWord(p, op.untilWord, words).end - start : op.untilSource !== undefined ? sourceToTimeline(p, op.untilSource, true) - start : op.duration;
  if (duration === undefined) throw new Error("informe duration, untilWord ou untilSource");
  if (duration < MIN_CLIP) throw new Error("o fim precisa vir depois do início");
  return { start: r3(start), duration: r3(duration) };
}

function resolveStart(p: Project, op: { start?: number; atWord?: string; atSource?: number }): number {
  const start = op.atWord ? timelineWord(p, op.atWord).start : op.atSource !== undefined ? sourceToTimeline(p, op.atSource) : op.start;
  if (start === undefined) throw new Error("informe atWord ou atSource (ou start)");
  return r3(start);
}

function primaryAssetId(p: Project): string | null {
  return [...mainClips(p)].sort((a, b) => a.start - b.start)[0]?.assetId ?? null;
}

/**
 * Onde um instante do vídeo BRUTO (asset principal) está na timeline atual.
 * Se ele caiu num trecho cortado, vale a emenda mais próxima; `end` escolhe o
 * fim do trecho anterior em vez do começo do seguinte.
 */
function sourceToTimeline(p: Project, source: number, end = false): number {
  const assetId = primaryAssetId(p);
  const clips = mainClips(p)
    .filter((c) => c.assetId === assetId)
    .sort((a, b) => a.start - b.start);
  if (!clips.length) throw new Error("não há vídeo na trilha principal para ancorar por tempo de origem");
  let best: { t: number; d: number } | null = null;
  for (const c of clips) {
    const se = sourceEnd(c);
    if (source >= c.sourceStart - 0.001 && source <= se + 0.001) return r3(c.start + localTimeAt(c, source));
    const dStart = Math.abs(source - c.sourceStart);
    const dEnd = Math.abs(source - se);
    const cand = dStart < dEnd ? { t: c.start, d: dStart } : { t: clipEnd(c), d: dEnd };
    if (!best || cand.d < best.d || (cand.d === best.d && end)) best = cand;
  }
  return r3(best!.t);
}

/**
 * Troca cada `atWord` dentro dos params pelo `at` correspondente (segundos
 * desde o início do clip), preso à duração do clip.
 */
function resolveTimedParams<T>(p: Project, value: T, clipStart: number, clipDuration: number, words?: ReturnType<typeof timelineWords>): T {
  if (Array.isArray(value)) return value.map((v) => resolveTimedParams(p, v, clipStart, clipDuration, words)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "atWord" && typeof v === "string") {
      words ??= timelineWords(p);
      out.at = r3(Math.min(Math.max(timelineWord(p, v, words).start - clipStart, 0), clipDuration));
    } else out[k] = resolveTimedParams(p, v, clipStart, clipDuration, words);
  }
  return out as T;
}

function mustFind(p: Project, clipId: string) {
  const found = findClip(p, clipId);
  if (!found) throw new Error(`clip ${clipId} não existe`);
  return found;
}

function mustFindMedia(p: Project, clipId: string) {
  const { clip } = mustFind(p, clipId);
  if (clip.type !== "media") throw new Error(`clip ${clipId} não é de vídeo`);
  return clip;
}

function mainEnd(p: Project): number {
  return mainClips(p).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Mantém zooms/overlays dentro da duração do vídeo principal. */
function fitToMain(p: Project, start: number, duration: number) {
  // Timeline sem vídeo (composição só com texto, cards e áudio): tudo é livre.
  if (!mainClips(p).length) return { start: r3(start), duration: r3(duration) };
  const end = mainEnd(p);
  if (start >= end - MIN_CLIP)
    throw new Error(`início ${fmt(start)} está além do fim do vídeo (${fmt(end)})`);
  return { start: r3(start), duration: r3(Math.min(duration, end - start)) };
}

function overlayTrackFor(p: Project, start: number, duration: number) {
  const end = start + duration;
  const free = p.tracks.find(
    (t) => t.kind === "overlay" && t.clips.every((c) => clipEnd(c) <= start || c.start >= end),
  );
  if (free) return free;
  const n = p.tracks.filter((t) => t.kind === "overlay").length + 1;
  const track = { id: newId("trk"), kind: "overlay" as const, name: `Motion ${n}`, clips: [] };
  p.tracks.unshift(track);
  return track;
}

/** Trilha de mídia de contexto com espaço livre no trecho; criada (acima do zoom) quando não há. */
function brollTrackFor(p: Project, start: number, duration: number) {
  const end = start + duration;
  const free = p.tracks.find((t) => t.kind === "broll" && t.clips.every((c) => clipEnd(c) <= start || c.start >= end));
  if (free) return free;
  const n = p.tracks.filter((t) => t.kind === "broll").length + 1;
  const track = { id: newId("trk"), kind: "broll" as const, name: n > 1 ? `Contexto ${n}` : "Contexto", clips: [] };
  const at = p.tracks.findIndex((t) => t.kind === "fx");
  p.tracks.splice(at < 0 ? p.tracks.length : at, 0, track);
  return track;
}

/** Abre `d` segundos em `at`, empurrando tudo que começa dali em diante (exceto `exceptId`). */
function insertTime(p: Project, at: number, d: number, exceptId?: string) {
  shiftFrom(p, at, d, exceptId);
}

/** Desloca em `d` (pode ser negativo) tudo que começa em `at` ou depois, em todas as trilhas, e os marcadores. */
function shiftFrom(p: Project, at: number, d: number, exceptId?: string, skip?: Set<string>) {
  if (Math.abs(d) < 0.0005) return;
  for (const t of p.tracks)
    for (const c of t.clips) if (c.id !== exceptId && !skip?.has(c.id) && c.start >= at - 0.001) c.start = r3(Math.max(0, c.start + d));
  for (const m of p.markers) if (m.t >= at - 0.001) m.t = r3(Math.max(0, m.t + d));
}

const hasSpeedClip = (c: MediaClip) => Boolean(c.speedRamp?.length) || (c.speed !== undefined && Math.abs(c.speed - 1) > 1e-6);

/** Trilha de efeitos sonoros; criada (logo abaixo do vídeo) no primeiro uso. */
function audioTrack(p: Project) {
  let track = p.tracks.find((t) => t.kind === "audio");
  if (!track) {
    track = { id: newId("trk"), kind: "audio", name: "Sons", clips: [] };
    p.tracks.push(track);
  }
  return track;
}

/** Divide o clip principal que contém `time`. Devolve false se não há clip ali (ou se cai numa borda). */
function splitMainAt(p: Project, time: number): boolean {
  const main = getTrack(p, "main");
  const clip = main.clips.find((c) => time > c.start + MIN_CLIP && time < clipEnd(c) - MIN_CLIP);
  if (!clip || clip.type !== "media") return false;
  const left = r3(time - clip.start);
  const a = mediaSlice(clip, 0, left);
  const b = mediaSlice(clip, left, clip.duration);
  const { speed: _s, speedRamp: _r, ...base } = clip;
  main.clips.push({ ...base, ...b, id: newId("clip"), start: r3(time) });
  Object.assign(clip, a);
  if (a.speed === undefined) delete clip.speed;
  if (a.speedRamp === undefined) delete clip.speedRamp;
  sortTrack(main);
  return true;
}

/**
 * Troca a velocidade de um clip mantendo o mesmo trecho de origem. A duração
 * na timeline muda; o que vem depois acompanha e o que está por cima do clip
 * (zooms, componentes, sons) continua preso ao mesmo instante da imagem.
 */
function setClipSpeed(p: Project, clip: MediaClip, next: { speed?: number; speedRamp?: MediaClip["speedRamp"] }) {
  const before = structuredClone(clip);
  const oldEnd = clipEnd(clip);
  const span = sourceSpan(clip);
  delete clip.speed;
  delete clip.speedRamp;
  if (next.speedRamp) clip.speedRamp = next.speedRamp.map((pt) => ({ u: r3(pt.u), rate: pt.rate }));
  else if (next.speed !== undefined && Math.abs(next.speed - 1) > 1e-6) clip.speed = next.speed;
  clip.duration = r3(span / rateAverage(clip));
  const remap = (t: number) => r3(clip.start + localTimeAt(clip, sourceTimeAt(before, t - before.start)));
  for (const t of p.tracks) {
    if (t.kind === "main") continue;
    for (const c of t.clips) {
      if (c.start < before.start - 0.001 || c.start >= oldEnd - 0.001) continue;
      const end = clipEnd(c);
      const start = remap(c.start);
      // Movimentos de câmera esticam junto com a imagem; textos e sons mantêm a própria duração.
      if ((c.type === "zoom" || c.type === "impact") && end <= oldEnd + 0.001) c.duration = Math.max(MIN_CLIP, r3(remap(end) - start));
      c.start = start;
    }
  }
  for (const m of p.markers) if (m.t >= before.start && m.t < oldEnd) m.t = remap(m.t);
  shiftFrom(p, oldEnd, clipEnd(clip) - oldEnd, clip.id, new Set(p.tracks.flatMap((t) => (t.kind === "main" ? [] : t.clips.filter((c) => c.start < clipEnd(clip) && c.start >= clip.start).map((c) => c.id)))));
}

/**
 * Move um clip da trilha principal. Posição livre quando cabe (cria lacunas);
 * solto sobre outro clip, ou em modo insert, sai de onde estava (ripple) e é
 * encaixado no ponto de corte mais próximo, empurrando o que vem depois. O
 * que estava por cima do clip (zooms, textos, sons) vai junto.
 */
function moveMainClip(p: Project, clip: MediaClip, to: number, mode: "auto" | "insert"): string {
  const main = getTrack(p, "main");
  const others = () => main.clips.filter((c) => c.id !== clip.id).sort((a, b) => a.start - b.start);
  const oldStart = clip.start;
  const oldEnd = clipEnd(clip);
  const dur = clip.duration;
  const linked = p.tracks.flatMap((t) => (t.kind === "main" ? [] : t.clips.filter((c) => c.start >= oldStart - 0.001 && c.start < oldEnd - 0.001)));
  const skip = new Set(linked.map((c) => c.id));
  let target = r3(Math.max(0, to));
  const overlaps = (t: number) => others().some((o) => t < clipEnd(o) - 0.001 && t + dur > o.start + 0.001);
  let how = "posição livre";
  if (mode === "insert" || overlaps(target)) {
    // Sai de onde estava, fechando o buraco…
    shiftFrom(p, oldEnd, -dur, clip.id, skip);
    if (target >= oldEnd - 0.001) target = r3(target - dur);
    // …e entra no ponto de corte mais próximo de onde foi solto.
    const under = others().find((o) => target >= o.start - 0.001 && target < clipEnd(o) - 0.001);
    const boundary = under ? (target - under.start < under.duration / 2 ? under.start : clipEnd(under)) : target;
    shiftFrom(p, boundary, dur, clip.id, skip);
    target = r3(boundary);
    how = "inserido entre clipes (ripple)";
  }
  const delta = target - oldStart;
  clip.start = target;
  for (const c of linked) c.start = r3(Math.max(0, c.start + delta));
  return `clip ${clip.id} movido para ${fmt(target)} — ${how}`;
}

/** Tira da trilha principal o que está em [start, end), SEM fechar o buraco (overwrite). */
function liftMain(p: Project, start: number, end: number) {
  const main = getTrack(p, "main");
  const next: Clip[] = [];
  for (const c of main.clips) {
    if (c.type !== "media" || clipEnd(c) <= start + 0.001 || c.start >= end - 0.001) {
      next.push(c);
      continue;
    }
    const { speed: _s, speedRamp: _r, ...base } = c;
    if (c.start < start) next.push({ ...base, ...mediaSlice(c, 0, start - c.start) });
    if (clipEnd(c) > end) next.push({ ...base, ...mediaSlice(c, end - c.start, c.duration), id: c.start < start ? newId("clip") : c.id, start: r3(end) });
  }
  main.clips = next.filter((c) => c.duration >= MIN_CLIP);
}

function insertMainClip(p: Project, op: Extract<Operation, { op: "insert_clip" }>): string {
  const asset = p.assets[op.assetId];
  if (!asset || asset.kind === "audio") throw new Error(`mídia ${op.assetId} não existe no projeto`);
  const still = asset.kind === "image";
  const sourceStart = still ? 0 : Math.min(op.sourceStart, Math.max(0, asset.duration - MIN_CLIP));
  let duration = r3(Math.min(op.duration ?? Infinity, still ? (op.duration ?? asset.duration) : asset.duration - sourceStart));
  const main = getTrack(p, "main");
  const sorted = mainClips(p).sort((a, b) => a.start - b.start);
  let at = r3(op.at);
  let how: string;
  if (op.mode === "overwrite") {
    liftMain(p, at, at + duration);
    how = "sobrescrevendo o trecho";
  } else {
    const under = sorted.find((c) => at >= c.start - 0.001 && at < clipEnd(c) - 0.001);
    if (under) {
      // Sobre um clip: entra no ponto de corte mais próximo, empurrando o resto. Nada é sobrescrito.
      at = at - under.start < under.duration / 2 ? under.start : clipEnd(under);
      shiftFrom(p, at, duration);
      how = "inserido entre clipes, empurrando os seguintes (ripple)";
    } else {
      const next = sorted.find((c) => c.start >= at - 0.001);
      const room = next ? next.start - at : Infinity;
      if (duration <= room + 0.001) how = next ? "encaixado na lacuna" : "no fim da trilha";
      else if (op.mode === "insert") {
        shiftFrom(p, next!.start, duration - room);
        how = "encaixado na lacuna, empurrando os seguintes";
      } else {
        const cut = r3(duration - room);
        duration = r3(room);
        how = `ajustado à lacuna: ${fmt(cut)} do fim ficaram de fora (arraste a borda para recuperar)`;
      }
    }
  }
  if (duration < MIN_CLIP) throw new Error("não há espaço para a mídia nesse ponto");
  const id = newId("clip");
  main.clips.push({ id, type: "media", assetId: asset.id, start: r3(at), duration, sourceStart: r3(sourceStart), volume: 1 });
  return `"${asset.name}" (${id}) em ${fmt(at)} — ${how}`;
}

/**
 * Ripple delete em todas as trilhas. `ranges` deve estar normalizado
 * (ordenado, sem sobreposição) e em tempo da timeline atual.
 */
function removeRanges(p: Project, ranges: TimeRange[]) {
  // Do fim para o começo: cortes posteriores não deslocam os anteriores.
  for (const range of [...ranges].reverse()) {
    const rs = r3(range.start);
    const re = r3(range.end);
    const len = r3(re - rs);
    for (const track of p.tracks) {
      const next: Clip[] = [];
      for (const c of track.clips) {
        const cs = c.start;
        const ce = clipEnd(c);
        if (ce <= rs) {
          next.push(c);
        } else if (cs >= re) {
          next.push({ ...c, start: r3(cs - len) });
        } else if (cs >= rs && ce <= re) {
          // totalmente dentro do corte: some
        } else if (cs < rs && ce > re) {
          if (c.type === "media") {
            const { speed: _s, speedRamp: _r, ...base } = c;
            next.push({ ...base, ...mediaSlice(c, 0, rs - cs) });
            next.push({ ...base, ...mediaSlice(c, re - cs, c.duration), id: newId("clip"), start: rs });
          } else if (c.type === "component") {
            next.push({ ...c, duration: r3(c.duration - len), params: shiftTimedParams(c.params, rs - cs, len) });
          } else {
            next.push({ ...c, duration: r3(c.duration - len) });
          }
        } else if (cs < rs) {
          if (c.type === "media") {
            const { speed: _s, speedRamp: _r, ...base } = c;
            next.push({ ...base, ...mediaSlice(c, 0, rs - cs) });
          } else next.push({ ...c, duration: r3(rs - cs) });
        } else if (c.type === "media") {
          const { speed: _s, speedRamp: _r, ...base } = c;
          next.push({ ...base, ...mediaSlice(c, re - cs, c.duration), start: rs });
        } else {
          const cut = r3(re - cs);
          const trimmed = { ...c, start: rs, duration: r3(ce - re) };
          if (trimmed.type === "broll") trimmed.sourceStart = r3(trimmed.sourceStart + cut);
          if (trimmed.type === "component") trimmed.params = shiftTimedParams(trimmed.params, 0, cut);
          next.push(trimmed);
        }
      }
      track.clips = next.filter((c) => c.duration >= MIN_CLIP);
    }
    p.markers = p.markers.map((m) => (m.t >= re ? { ...m, t: r3(m.t - len) } : m.t > rs ? { ...m, t: rs } : m));
  }
}

/**
 * Componentes podem marcar instantes internos com `at` (segundos desde o
 * início do clip — ex.: quando cada barra entra). Um corte dentro do clip
 * desloca esses instantes junto com a fala: depois do corte, `at` recua
 * `len`; dentro do corte, vai para o ponto do corte.
 */
export function shiftTimedParams<T>(value: T, cutAt: number, len: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftTimedParams(v, cutAt, len)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "at" && typeof v === "number")
      out[k] = v >= cutAt + len ? r3(v - len) : v > cutAt ? r3(cutAt) : v;
    else out[k] = shiftTimedParams(v, cutAt, len);
  }
  return out as T;
}
