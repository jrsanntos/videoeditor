import type { Clip, MediaClip, Project, Track } from "./schema";
import { clipEnd, hasSpeed, projectDuration, rateAverage, sourceSpan } from "./timeline";

/**
 * Exportação interoperável para OpenTimelineIO (.otio): a timeline abre em
 * DaVinci Resolve, Premiere (via adaptador), Final Cut e afins, com clips,
 * lacunas, velocidades, b-roll e marcadores. Os arquivos de mídia são
 * referenciados pelo nome — o editor religa a mídia no destino.
 */
type Otio = Record<string, unknown>;

const rt = (seconds: number, rate: number): Otio => ({ OTIO_SCHEMA: "RationalTime.1", value: Math.round(seconds * rate), rate });
const range = (start: number, duration: number, rate: number): Otio => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });
const gap = (duration: number, rate: number): Otio => ({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, duration, rate), effects: [], markers: [], metadata: {} });

function mediaReference(project: Project, assetId: string, rate: number): Otio {
  const asset = project.assets[assetId];
  if (!asset) return { OTIO_SCHEMA: "MissingReference.1", name: assetId, metadata: {} };
  return { OTIO_SCHEMA: "ExternalReference.1", name: asset.name, target_url: asset.name, available_range: range(0, asset.duration, rate), metadata: { videoeditor: { assetId, hash: asset.hash ?? null } } };
}

function clipItem(project: Project, c: Clip, rate: number): Otio {
  const item = (name: string, source: Otio, ref: Otio, extra: Otio = {}): Otio => ({
    OTIO_SCHEMA: "Clip.2",
    name,
    source_range: source,
    media_references: { DEFAULT_MEDIA: ref },
    active_media_reference_key: "DEFAULT_MEDIA",
    effects: [],
    markers: [],
    metadata: {},
    ...extra,
  });
  if (c.type === "media") {
    const speed = hasSpeed(c) ? rateAverage(c) : 1;
    return item(project.assets[c.assetId]?.name ?? c.id, range(c.sourceStart, sourceSpan(c), rate), mediaReference(project, c.assetId, rate), {
      effects: hasSpeed(c) ? [{ OTIO_SCHEMA: "LinearTimeWarp.1", name: c.speedRamp ? "Speed ramp" : "Speed", effect_name: "LinearTimeWarp", time_scalar: Math.round(speed * 1000) / 1000, metadata: c.speedRamp ? { videoeditor: { speedRamp: c.speedRamp } } : {} }] : [],
      metadata: { videoeditor: { clipId: c.id, volume: c.volume, timelineDuration: c.duration } },
    });
  }
  if (c.type === "broll") return item(project.assets[c.assetId]?.name ?? c.id, range(c.sourceStart, c.duration, rate), mediaReference(project, c.assetId, rate), { metadata: { videoeditor: { clipId: c.id, layout: c.layout } } });
  // Zooms, componentes, impactos e sons: sem mídia própria; vão como clips sem referência, com os parâmetros nos metadados.
  const name = c.type === "component" ? c.component : c.type === "zoom" ? `Zoom ${c.scale}x` : c.type === "sfx" ? `SFX ${c.sfx}` : `Impact ${c.kind}`;
  return item(name, range(0, c.duration, rate), { OTIO_SCHEMA: "MissingReference.1", name, metadata: {} }, { metadata: { videoeditor: c } });
}

function trackItems(project: Project, track: Track, rate: number): Otio[] {
  const out: Otio[] = [];
  let cursor = 0;
  for (const c of [...track.clips].sort((a, b) => a.start - b.start)) {
    // OTIO não tem posição absoluta: o espaço vazio é um Gap explícito.
    if (c.start - cursor > 0.5 / rate) out.push(gap(c.start - cursor, rate));
    out.push(clipItem(project, c, rate));
    cursor = Math.max(cursor, clipEnd(c));
  }
  return out;
}

export function toOTIO(project: Project): Otio {
  const rate = project.fps;
  const track = (t: Track, kind: "Video" | "Audio", name = t.name): Otio => ({ OTIO_SCHEMA: "Track.1", name, kind, children: trackItems(project, t, rate), source_range: null, effects: [], markers: [], metadata: { videoeditor: { trackId: t.id, kind: t.kind } } });
  // A pilha do OTIO vai de baixo para cima; as trilhas do projeto, de cima para baixo.
  const video = [...project.tracks].reverse().filter((t) => t.kind !== "audio");
  const main = project.tracks.find((t) => t.kind === "main");
  const audio: Otio[] = [];
  if (main) {
    const voiced: Track = { ...main, clips: main.clips.filter((c): c is MediaClip => c.type === "media" && project.assets[c.assetId]?.hasAudio !== false) };
    audio.push(track(voiced, "Audio", "Áudio do vídeo"));
  }
  for (const t of project.tracks) if (t.kind === "audio") audio.push(track(t, "Audio"));
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: project.name,
    global_start_time: rt(0, rate),
    metadata: { videoeditor: { version: project.version, width: project.width, height: project.height, aspectRatio: project.aspectRatio, duration: projectDuration(project), look: project.look, music: project.music, captions: project.captions } },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: [...video.map((t) => track(t, "Video")), ...audio],
      source_range: null,
      effects: [],
      metadata: {},
      markers: project.markers.map((m) => ({ OTIO_SCHEMA: "Marker.2", name: m.label ?? "", color: "RED", marked_range: range(m.t, 0, rate), metadata: { videoeditor: { markerId: m.id } } })),
    },
  };
}
