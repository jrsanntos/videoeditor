import { z } from "zod";
import { BrandKitSchema, CaptionStyleSchema, type Clip, type Project, type TimeRange } from "./schema";
import {
  MIN_CLIP,
  clipEnd,
  findClip,
  getTrack,
  mainClips,
  newId,
  normalizeRanges,
  projectDuration,
  r3,
  sortTrack,
  sourceRangesToTimeline,
  timelineWord,
  timelineWords,
  wordCutRange,
} from "./timeline";
import { findRetakes } from "./retakes";
import { silencesFromWords } from "./silence";

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
    minSilence: z.number().min(0.15).default(0.5).describe("pausa mínima (s) para cortar"),
    padding: z.number().min(0).default(0.1).describe("respiro (s) mantido em cada lado da fala"),
    range: RangeSchema.optional().describe("limita a detecção a este trecho"),
    fromWord: z.string().optional().describe("limita a detecção: a partir desta palavra"),
    toWord: z.string().optional().describe("limita a detecção: até esta palavra"),
  })
  .describe("Detecta pausas entre palavras da transcrição e as remove de forma determinística.");
const Split = z
  .object({ op: z.literal("split"), time: z.number().min(0) })
  .describe("Divide o clip de vídeo principal no tempo indicado.");
const DeleteClip = z
  .object({ op: z.literal("delete_clip"), clipId: z.string() })
  .describe("Remove um clip. Na trilha principal o buraco é fechado (ripple).");
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
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.4),
  ease: z.number().min(0).default(0.25),
};
const AddZoom = z
  .object({
    op: z.literal("add_zoom"),
    start: z.number().min(0).optional().describe("início em tempo de timeline; alternativa a atWord"),
    atWord: atWord.optional(),
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    ...zoomFields,
  })
  .describe("Zoom no vídeo principal. ease=0 gera punch-in seco; ease>0 gera zoom suave.");
const componentParams = z
  .record(z.string(), z.unknown())
  .describe(
    "params do componente. Onde o componente aceita um instante `at` (segundos desde o início dele), você pode mandar `atWord` com o id da palavra: o instante é calculado na aplicação.",
  );
const AddComponent = z
  .object({
    op: z.literal("add_component"),
    component: z.string().describe("id de um componente do catálogo"),
    start: z.number().min(0).optional().describe("início em tempo de timeline; alternativa a atWord"),
    atWord: atWord.optional(),
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    params: componentParams,
  })
  .describe("Insere um componente de motion design do catálogo sobre o vídeo.");
const UpdateClip = z
  .object({
    op: z.literal("update_clip"),
    clipId: z.string(),
    start: z.number().min(0).optional(),
    atWord: atWord.optional(),
    duration: z.number().positive().optional(),
    untilWord: untilWord.optional(),
    volume: z.number().min(0).max(2).optional(),
    scale: z.number().min(1).max(4).optional(),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    ease: z.number().min(0).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
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
const SetBrand = z
  .object({ op: z.literal("set_brand"), brand: BrandKitSchema.partial() })
  .describe("Altera o Brand Kit do projeto (cores, par de fontes, nome e credencial).");

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
  UpdateClip,
  SetCaptions,
  EditWord,
  SetBrand,
]);
export type Operation = z.infer<typeof OperationSchema>;
export type OperationInput = z.input<typeof OperationSchema>;

/**
 * Vocabulário do agente: as mesmas operações, só com referências estáveis
 * (palavra/clip). Tempo de timeline fica de fora — ele muda a cada corte e é
 * a origem dos erros de sincronia.
 */
export const AgentOperationSchema = z.discriminatedUnion("op", [
  CutWords,
  RemoveRetakes,
  RemoveSilences.omit({ range: true }),
  AddZoom.omit({ start: true }).extend({ atWord }),
  AddComponent.omit({ start: true }).extend({ atWord }),
  UpdateClip.omit({ start: true }),
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
  validateComponent?: (component: string, params: Record<string, unknown>) => Record<string, unknown>;
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
      if (!words.length) throw new Error("o vídeo ainda não tem transcrição; transcreva antes de remover erros de gravação");
      const takes = findRetakes(words).filter((r) => op.minConfidence === "media" || r.confidence === "alta");
      if (!takes.length) return "nenhum take ruim encontrado";
      return cutWords(p, takes).replace("corte(s)", "take(s) ruim(ns) cortado(s)");
    }
    case "remove_silences": {
      const words = timelineWords(p);
      if (!words.length)
        throw new Error("o vídeo ainda não tem transcrição; transcreva antes de remover silêncios");
      let ranges = silencesFromWords(words, mainEnd(p), op);
      if (op.range || op.fromWord || op.toWord) {
        const start = op.fromWord ? timelineWord(p, op.fromWord, words).start : (op.range?.start ?? 0);
        const end = op.toWord ? timelineWord(p, op.toWord, words).end : (op.range?.end ?? Infinity);
        ranges = normalizeRanges(
          ranges.map((r) => ({ start: Math.max(r.start, start), end: Math.min(r.end, end) })),
        );
      }
      if (!ranges.length) return "nenhum silêncio acima do limite encontrado";
      removeRanges(p, ranges);
      const total = ranges.reduce((s, r) => s + r.end - r.start, 0);
      return `${ranges.length} silêncio(s) removidos, ${fmt(total)} a menos`;
    }
    case "split": {
      const main = getTrack(p, "main");
      const clip = main.clips.find(
        (c) => op.time > c.start + MIN_CLIP && op.time < clipEnd(c) - MIN_CLIP,
      );
      if (!clip || clip.type !== "media") throw new Error(`não há clip para dividir em ${fmt(op.time)}`);
      const left = r3(op.time - clip.start);
      main.clips.push({
        ...clip,
        id: newId("clip"),
        start: r3(op.time),
        duration: r3(clip.duration - left),
        sourceStart: r3(clip.sourceStart + left),
      });
      clip.duration = left;
      return `clip dividido em ${fmt(op.time)}`;
    }
    case "delete_clip": {
      const found = mustFind(p, op.clipId);
      if (found.track.kind === "main") {
        removeRanges(p, [{ start: found.clip.start, end: clipEnd(found.clip) }]);
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
      getTrack(p, "fx").clips.push({
        id: newId("zoom"),
        type: "zoom",
        start,
        duration,
        scale: op.scale,
        x: op.x,
        y: op.y,
        ease: Math.min(op.ease, duration / 2),
      });
      return `zoom ${op.scale}x em ${fmt(start)} por ${fmt(duration)}`;
    }
    case "add_component": {
      const span = resolveSpan(p, op);
      const { start, duration } = fitToMain(p, span.start, span.duration);
      const timed = resolveTimedParams(p, op.params, start, duration);
      const params = ctx.validateComponent ? ctx.validateComponent(op.component, timed) : timed;
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
    case "update_clip": {
      const { clip } = mustFind(p, op.clipId);
      if (clip.type === "media") {
        if (op.volume === undefined)
          throw new Error("em clips de vídeo só o volume é alterável aqui; use trim_clip/split");
        clip.volume = op.volume;
        return `volume do clip ${clip.id} = ${op.volume}`;
      }
      if (op.start !== undefined || op.atWord || op.duration !== undefined || op.untilWord) {
        const span = resolveSpan(p, { start: op.start ?? (op.atWord ? undefined : clip.start), atWord: op.atWord, duration: op.duration ?? (op.untilWord ? undefined : clip.duration), untilWord: op.untilWord });
        clip.start = span.start;
        clip.duration = span.duration;
      }
      if (clip.type === "zoom") {
        if (op.scale !== undefined) clip.scale = op.scale;
        if (op.x !== undefined) clip.x = op.x;
        if (op.y !== undefined) clip.y = op.y;
        if (op.ease !== undefined) clip.ease = op.ease;
        clip.ease = Math.min(clip.ease, clip.duration / 2);
      } else if (op.params) {
        const merged = { ...clip.params, ...resolveTimedParams(p, op.params, clip.start, clip.duration) };
        clip.params = ctx.validateComponent ? ctx.validateComponent(clip.component, merged) : merged;
      }
      return `clip ${clip.id} atualizado`;
    }
    case "set_captions": {
      if (op.enabled !== undefined) p.captions.enabled = op.enabled;
      if (op.style) p.captions.style = CaptionStyleSchema.parse({ ...p.captions.style, ...op.style });
      return `legendas ${p.captions.enabled ? "ligadas" : "desligadas"}`;
    }
    case "set_brand": {
      p.brand = BrandKitSchema.parse({ ...p.brand, ...op.brand });
      return "brand kit atualizado";
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
  op: { start?: number; atWord?: string; duration?: number; untilWord?: string },
): { start: number; duration: number } {
  const words = op.atWord || op.untilWord ? timelineWords(p) : [];
  const start = op.atWord ? timelineWord(p, op.atWord, words).start : op.start;
  if (start === undefined) throw new Error("informe atWord (ou start)");
  const duration = op.untilWord ? timelineWord(p, op.untilWord, words).end - start : op.duration;
  if (duration === undefined) throw new Error("informe duration ou untilWord");
  if (duration < MIN_CLIP) throw new Error("o fim precisa vir depois do início");
  return { start: r3(start), duration: r3(duration) };
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

/** Abre `d` segundos em `at`, empurrando tudo que começa dali em diante (exceto `exceptId`). */
function insertTime(p: Project, at: number, d: number, exceptId?: string) {
  for (const t of p.tracks)
    for (const c of t.clips) if (c.id !== exceptId && c.start >= at - 0.001) c.start = r3(c.start + d);
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
            next.push({ ...c, duration: r3(rs - cs) });
            next.push({
              ...c,
              id: newId("clip"),
              start: rs,
              duration: r3(ce - re),
              sourceStart: r3(c.sourceStart + (re - cs)),
            });
          } else if (c.type === "component") {
            next.push({ ...c, duration: r3(c.duration - len), params: shiftTimedParams(c.params, rs - cs, len) });
          } else {
            next.push({ ...c, duration: r3(c.duration - len) });
          }
        } else if (cs < rs) {
          next.push({ ...c, duration: r3(rs - cs) });
        } else {
          const cut = r3(re - cs);
          const trimmed = { ...c, start: rs, duration: r3(ce - re) };
          if (trimmed.type === "media") trimmed.sourceStart = r3(trimmed.sourceStart + cut);
          if (trimmed.type === "component") trimmed.params = shiftTimedParams(trimmed.params, 0, cut);
          next.push(trimmed);
        }
      }
      track.clips = next.filter((c) => c.duration >= MIN_CLIP);
    }
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
