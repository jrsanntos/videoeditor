import type {
  Asset,
  Clip,
  MediaClip,
  Project,
  TimeRange,
  Track,
  TrackKind,
  Word,
} from "./schema";
import { CaptionStyleSchema } from "./schema";

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
}): Project {
  return {
    version: 1,
    id: newId("prj"),
    name: opts.name,
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    fps: opts.fps ?? 30,
    assets: {},
    tracks: [
      { id: newId("trk"), kind: "overlay", name: "Motion", clips: [] },
      { id: newId("trk"), kind: "fx", name: "Zoom", clips: [] },
      { id: newId("trk"), kind: "main", name: "Vídeo", clips: [] },
    ],
    captions: { enabled: false, style: CaptionStyleSchema.parse({}) },
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
