import type {
  Asset,
  BrandKit,
  Clip,
  MediaClip,
  Project,
  TimeRange,
  Track,
  TrackKind,
  Word,
} from "./schema";
import { CaptionStyleSchema, defaultBrandKit, FORMATS, type AspectRatio } from "./schema";

export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const clipEnd = (c: { start: number; duration: number }) => r3(c.start + c.duration);

/** Clips menores que isso são descartados (menos de um frame a 30fps). */
export const MIN_CLIP = 0.03;

let counter = 0;
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}${(counter++).toString(36)}`;
}

export function createProject(opts: {
  name: string;
  width?: number;
  height?: number;
  fps?: number;
  brand?: BrandKit;
  /** Padrão: vertical 9:16. */
  aspectRatio?: AspectRatio;
}): Project {
  const aspectRatio = opts.aspectRatio ?? "9:16";
  return {
    version: 1,
    id: newId("prj"),
    name: opts.name,
    width: opts.width ?? FORMATS[aspectRatio].width,
    height: opts.height ?? FORMATS[aspectRatio].height,
    fps: opts.fps ?? 30,
    assets: {},
    tracks: [
      { id: newId("trk"), kind: "overlay", name: "Motion", clips: [] },
      { id: newId("trk"), kind: "fx", name: "Zoom", clips: [] },
      { id: newId("trk"), kind: "main", name: "Vídeo", clips: [] },
    ],
    captions: { enabled: false, style: CaptionStyleSchema.parse({}) },
    brand: opts.brand ?? defaultBrandKit(),
    aspectRatio,
    framing: { x: 0.5, y: 0.5 },
    sfx: { enabled: true, volume: 1 },
    finish: { cutZoom: true, voice: true },
  };
}

/** Adiciona um asset e o coloca inteiro no fim da trilha principal. */
export function addAssetToProject(project: Project, asset: Asset): Project {
  const next = structuredClone(project);
  next.assets[asset.id] = asset;
  const main = getTrack(next, "main");
  const at = main.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  main.clips.push({
    id: newId("clip"),
    type: "media",
    assetId: asset.id,
    start: at,
    duration: r3(asset.duration),
    sourceStart: 0,
    volume: 1,
  });
  return next;
}

/** Registra uma mídia de contexto no projeto (sem colocá-la na timeline). */
export function addContextAsset(project: Project, asset: Asset): Project {
  const next = structuredClone(project);
  next.assets[asset.id] = { ...asset, role: "context" };
  return next;
}

export const contextAssets = (project: Project): Asset[] => Object.values(project.assets).filter((a) => a.role === "context");

export function getTrack(project: Project, kind: TrackKind): Track {
  const t = project.tracks.find((t) => t.kind === kind);
  if (!t) throw new Error(`Trilha "${kind}" não existe no projeto`);
  return t;
}

export function mainClips(project: Project): MediaClip[] {
  return getTrack(project, "main").clips.filter((c): c is MediaClip => c.type === "media");
}

export function projectDuration(project: Project): number {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return r3(end);
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function mainClipAt(project: Project, t: number): MediaClip | null {
  for (const c of mainClips(project)) if (t >= c.start && t < c.start + c.duration) return c;
  return null;
}

export function clipsAt<T extends Clip["type"]>(
  project: Project,
  t: number,
  type: T,
): Extract<Clip, { type: T }>[] {
  const out: Extract<Clip, { type: T }>[] = [];
  for (const track of project.tracks)
    for (const c of track.clips)
      if (c.type === type && t >= c.start && t < c.start + c.duration)
        out.push(c as Extract<Clip, { type: T }>);
  return out;
}

export function sortTrack(track: Track) {
  track.clips.sort((a, b) => a.start - b.start);
}

/** Une faixas sobrepostas/adjacentes e descarta as inválidas. */
export function normalizeRanges(ranges: TimeRange[], max = Infinity): TimeRange[] {
  const sorted = ranges
    .map((r) => ({ start: r3(Math.max(0, r.start)), end: r3(Math.min(max, r.end)) }))
    .filter((r) => r.end - r.start > 0.001)
    .sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.001) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export type TimelineWord = Word & { clipId: string; assetId: string };

/**
 * Palavras da transcrição projetadas em tempo de TIMELINE, através dos clips
 * da trilha principal. Cortar um clip remove automaticamente suas palavras —
 * é isso que mantém legendas e contexto do agente sempre sincronizados.
 */
export function timelineWords(project: Project, range?: TimeRange): TimelineWord[] {
  const out: TimelineWord[] = [];
  for (const clip of mainClips(project)) {
    const words = project.assets[clip.assetId]?.transcript?.words;
    if (!words) continue;
    const srcEnd = clip.sourceStart + clip.duration;
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < clip.sourceStart || mid >= srcEnd) continue;
      const start = r3(clip.start + Math.max(w.start, clip.sourceStart) - clip.sourceStart);
      const end = r3(clip.start + Math.min(w.end, srcEnd) - clip.sourceStart);
      if (range && (end <= range.start || start >= range.end)) continue;
      out.push({ ...w, start, end, clipId: clip.id, assetId: clip.assetId });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Converte faixas em tempo de origem de um asset para tempo de timeline. */
export function sourceRangesToTimeline(
  project: Project,
  assetId: string,
  ranges: TimeRange[],
): TimeRange[] {
  const out: TimeRange[] = [];
  for (const clip of mainClips(project)) {
    if (clip.assetId !== assetId) continue;
    const srcEnd = clip.sourceStart + clip.duration;
    for (const r of ranges) {
      const s = Math.max(r.start, clip.sourceStart);
      const e = Math.min(r.end, srcEnd);
      if (e - s > 0.001)
        out.push({ start: clip.start + s - clip.sourceStart, end: clip.start + e - clip.sourceStart });
    }
  }
  return normalizeRanges(out);
}

/**
 * Faixa de ORIGEM que remove as palavras `fromId`…`toId` (inclusive) de um
 * asset: do início da primeira até o início da palavra seguinte à última, de
 * modo que o corte caia sempre no intervalo entre palavras.
 */
export function wordCutRange(project: Project, fromId: string, toId: string): { assetId: string; range: TimeRange; text: string } {
  for (const asset of Object.values(project.assets)) {
    const words = asset.transcript?.words;
    if (!words) continue;
    const a = words.findIndex((w) => w.id === fromId);
    if (a < 0) continue;
    const b = words.findIndex((w) => w.id === toId);
    if (b < 0) throw new Error(`palavra ${toId} não existe na transcrição`);
    if (b < a) throw new Error(`o corte ${fromId}→${toId} está invertido`);
    const next = words[b + 1];
    return {
      assetId: asset.id,
      range: { start: words[a]!.start, end: next ? Math.max(next.start, words[b]!.end) : words[b]!.end },
      text: words
        .slice(a, b + 1)
        .map((w) => w.text)
        .join(" "),
    };
  }
  throw new Error(`palavra ${fromId} não existe na transcrição`);
}

/** Posição atual de uma palavra na timeline. Lança se ela não existe ou já foi cortada. */
export function timelineWord(project: Project, wordId: string, words = timelineWords(project)): TimelineWord {
  const w = words.find((w) => w.id === wordId);
  if (!w) throw new Error(`palavra ${wordId} não está na timeline (não existe ou já foi cortada)`);
  return w;
}

export type SubjectBox = { x: number; y: number; w: number; h: number; faceX: number; faceY: number };

/**
 * Onde o apresentador está no QUADRO DO PROJETO (frações 0–1) no instante `t`
 * da timeline, já com o recorte de enquadramento aplicado. null quando o vídeo
 * ainda não foi analisado.
 */
export function subjectAt(project: Project, t: number): SubjectBox | null {
  const clip = mainClipAt(project, t) ?? mainClips(project)[0];
  const asset = clip ? project.assets[clip.assetId] : null;
  const samples = asset?.subject;
  if (!clip || !asset || !samples?.length || !asset.width || !asset.height) return null;
  const srcT = clip.sourceStart + Math.max(0, Math.min(t - clip.start, clip.duration));
  let best = samples[0]!;
  for (const s of samples) if (Math.abs(s.t - srcT) < Math.abs(best.t - srcT)) best = s;
  const { width: W, height: H } = project;
  const s0 = Math.max(W / asset.width, H / asset.height);
  const w0 = asset.width * s0;
  const h0 = asset.height * s0;
  const x0 = (W - w0) * project.framing.x;
  const y0 = (H - h0) * project.framing.y;
  const fx = (v: number) => (x0 + v * w0) / W;
  const fy = (v: number) => (y0 + v * h0) / H;
  const c = (v: number) => r3(Math.min(1, Math.max(0, v)));
  const left = c(fx(best.x));
  const top = c(fy(best.y));
  return {
    x: left,
    y: top,
    w: r3(c(fx(best.x + best.w)) - left),
    h: r3(c(fy(best.y + best.h)) - top),
    faceX: c(fx(best.faceX)),
    faceY: c(fy(best.faceY)),
  };
}

const jumpCache = new WeakMap<Project, Map<string, number>>();

/**
 * Quantos cortes de verdade (saltos no vídeo bruto) existem antes de cada clip
 * da trilha principal. Um clip apenas dividido, sem material removido, não conta.
 */
export function jumpsBefore(project: Project, clipId: string): number {
  let map = jumpCache.get(project);
  if (!map) {
    map = new Map();
    let jumps = 0;
    let prev: MediaClip | null = null;
    for (const c of mainClips(project).sort((a, b) => a.start - b.start)) {
      if (prev && (prev.assetId !== c.assetId || Math.abs(c.sourceStart - (prev.sourceStart + prev.duration)) > 0.12)) jumps++;
      map.set(c.id, jumps);
      prev = c;
    }
    jumpCache.set(project, map);
  }
  return map.get(clipId) ?? 0;
}
