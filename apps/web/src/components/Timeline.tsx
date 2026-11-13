"use client";

import { useEffect, useRef, useState } from "react";
import { clipEnd, hasSpeed, mainClipAt, mainGaps, MIN_CLIP, MUSIC_NAMES, projectDuration, rateAverage, sourceTimeAt, type Clip, type MediaClip, type Project, type Track } from "@videoeditor/core";
import { captionGroups, COMPONENTS, type CaptionGroup } from "@videoeditor/renderer";
import { addContextMedia, addMainVideo, insertBroll, insertOnMain } from "@/lib/actions";
import { useEditor } from "@/lib/store";
import { loadPeaks, PEAKS_PER_SEC, peaksFor } from "@/lib/waveform";
import { formatTime } from "./Player";
import { Icon, ResizeHandle } from "./ui";

/** Largura da coluna com o nome das trilhas. */
const LABEL = 96;
const PAD = LABEL + 12;
const MIN_LEN = 0.2;
const ROW: Record<Track["kind"] | "captions", number> = { overlay: 34, broll: 40, fx: 34, main: 60, audio: 28, captions: 32 };
/** Distância (px) em que uma borda "gruda" em outra borda, no cursor ou num marcador. */
const SNAP_PX = 9;
/** Tipo de dado do arraste de uma mídia do painel para a timeline. */
export const ASSET_DND = "application/x-videoeditor-asset";

type DragMode = "move" | "left" | "right";
type Drag = { clipId: string; mode: DragMode; dx: number; snap?: number | null };

/** Pontos de snapping: bordas de todos os clips (menos o arrastado), cursor, marcadores e o zero. */
function snapPoints(project: Project, exceptId: string | null, playhead: number): number[] {
  const pts = new Set<number>([0, round(playhead)]);
  for (const t of project.tracks)
    for (const c of t.clips) {
      if (c.id === exceptId) continue;
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
  for (const m of project.markers) pts.add(m.t);
  return [...pts];
}

/** Ajusta `start` para que o início ou o fim do clip grude no ponto mais próximo, se houver um dentro do alcance. */
function snapMove(start: number, duration: number, points: number[], reach: number): { start: number; at: number | null } {
  let best: { start: number; at: number; d: number } | null = null;
  for (const p of points) {
    for (const cand of [{ s: p, d: Math.abs(start - p) }, { s: p - duration, d: Math.abs(start + duration - p) }])
      if (cand.d <= reach && cand.s >= 0 && (!best || cand.d < best.d)) best = { start: cand.s, at: p, d: cand.d };
  }
  return best ? { start: best.start, at: best.at } : { start, at: null };
}

export function splitAtPlayhead() {
  const s = useEditor.getState();
  s.apply([{ op: "split", time: s.time }]);
}

/**
 * Delete = ripple delete (fecha o buraco). Com `lift` (Shift+Delete), um clip
 * da trilha principal sai e deixa a lacuna no lugar.
 */
export function deleteSelection(lift = false) {
  const s = useEditor.getState();
  if (s.range) {
    if (!s.apply([{ op: "remove_ranges", ranges: [s.range] }])) {
      s.seek(s.range.start);
      s.setRange(null);
    }
  } else if (s.selectedCaption) {
    if (!s.apply([{ op: "edit_caption", wordIds: s.selectedCaption, hidden: true }])) s.selectCaption(null);
  } else if (s.selectedClipId) {
    if (!s.apply([{ op: "delete_clip", clipId: s.selectedClipId, ripple: !lift }])) s.select(null);
  }
}

/** Fecha a lacuna da trilha principal em que o cursor está (tudo que vem depois recua). */
export function closeGapAtPlayhead() {
  const s = useEditor.getState();
  if (!s.project) return;
  const gap = mainGaps(s.project).find((g) => s.time >= g.start - 0.001 && s.time < g.end);
  if (gap && !s.apply([{ op: "remove_ranges", ranges: [gap] }])) s.seek(gap.start);
}

export function addMarkerAtPlayhead() {
  const s = useEditor.getState();
  s.apply([{ op: "add_marker", time: round(s.time) }]);
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const range = useEditor((s) => s.range);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selectedCaption = useEditor((s) => s.selectedCaption);
  const height = useEditor((s) => s.layout.bottom);
  const aiFocus = useEditor((s) => s.aiFocus);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [captionDrag, setCaptionDrag] = useState<{ id: string; dx: number } | null>(null);
  /** Depois de um clique simples, o botão de dividir aparece no cursor. */
  const [splitHint, setSplitHint] = useState(false);
  const [, setPeaksReady] = useState(0);
  const [snapOn, setSnapOn] = useState(true);
  /** Onde uma mídia arrastada do painel (ou do computador) vai cair. */
  const [drop, setDrop] = useState<{ t: number; main: boolean } | null>(null);

  // Forma de onda do áudio (vídeos curtos e médios: decodificar horas de áudio pesaria no navegador).
  const assetKey = project
    ? Object.values(project.assets)
        .filter((a) => a.duration <= 20 * 60)
        .map((a) => a.id)
        .join(",")
    : "";
  useEffect(() => {
    for (const id of assetKey.split(",").filter(Boolean)) void loadPeaks(id).then(() => setPeaksReady((n) => n + 1));
  }, [assetKey]);

  if (!project) return null;
  const duration = projectDuration(project);
  const width = duration * pxPerSec + PAD + 240;
  /** Tempo sob o ponteiro, sem prender ao fim: soltar depois do último clip é válido. */
  const rawTimeAt = (clientX: number) => Math.max(0, (clientX - inner.current!.getBoundingClientRect().left - PAD) / pxPerSec);
  const dropTarget = (e: React.DragEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-track-kind]")?.dataset.trackKind;
    let t = rawTimeAt(e.clientX);
    if (snapOn) {
      const near = snapPoints(project, null, useEditor.getState().time).find((p) => Math.abs(p - t) * pxPerSec <= SNAP_PX);
      if (near !== undefined) t = near;
    }
    // Trilha principal (ou timeline vazia) = entra no vídeo; qualquer trilha de cima = overlay / b-roll.
    return { t: round(t), main: row === "main" || (!row && !mainGaps(project).length && duration === 0) };
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const target = dropTarget(e);
    setDrop(null);
    const assetId = e.dataTransfer.getData(ASSET_DND);
    if (assetId) return target.main ? insertOnMain(assetId, target.t) : insertBroll(assetId, target.t);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("video/") || f.type.startsWith("image/"));
    if (!file) return;
    if (target.main && file.type.startsWith("video/")) void addMainVideo(file, target.t);
    else void addContextMedia(file, file.name.replace(/\.[^.]+$/, "")).then((id) => id && insertBroll(id, target.t));
  };
  const timeAt = (clientX: number) => Math.max(0, Math.min(duration, (clientX - inner.current!.getBoundingClientRect().left - PAD) / pxPerSec));
  const hasWords = Object.values(project.assets).some((a) => a.transcript?.words.length);
  const captions = hasWords ? captionGroups(project) : [];

  /**
   * Fundo, régua e clips de vídeo: clicar posiciona o cursor (e oferece
   * dividir ali); arrastar seleciona um trecho para cortar ou mandar à IA.
   */
  const onAreaDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = inner.current!;
    const target = e.target as HTMLElement;
    const mediaId = target.closest<HTMLElement>("[data-media-clip]")?.dataset.clipId ?? null;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const t0 = timeAt(x0);
    let dragged = false;
    const s = useEditor.getState();
    s.setPlaying(false);
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 5) return;
      if (!dragged) {
        dragged = true;
        setSplitHint(false);
        s.select(null);
      }
      const t1 = timeAt(ev.clientX);
      s.setRange({ start: round(Math.min(t0, t1)), end: round(Math.max(t0, t1)) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      const r = useEditor.getState().range;
      if (dragged) {
        if (r && r.end - r.start < 0.1) s.setRange(null);
        return;
      }
      // Clique simples: um instante exato.
      s.setRange(null);
      s.seek(t0);
      s.select(mediaId);
      setSplitHint(true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const startClipDrag = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    // Clip de vídeo: arrastar pela barra do nome (ou com Alt em qualquer ponto) MOVE o clip, livre na
    // trilha; arrastar pelo corpo continua selecionando um trecho, como antes.
    if (clip.type === "media" && mode === "move" && !e.altKey && !(e.target as HTMLElement).closest("[data-grip]")) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let dx = 0;
    const s0 = useEditor.getState();
    s0.select(clip.id);
    // Leva o cursor para dentro do clip, para o que está sendo editado aparecer no vídeo.
    if (s0.time < clip.start || s0.time >= clipEnd(clip)) s0.seek(clip.start + Math.min(1.2, clip.duration / 2));
    setSplitHint(false);
    const points = snapOn ? snapPoints(project, clip.id, s0.time) : [];
    const move = (ev: PointerEvent) => {
      dx = (ev.clientX - x0) / pxPerSec;
      let snap: number | null = null;
      // Snapping magnético: a borda do clip gruda em outras bordas, no cursor e nos marcadores (Ctrl solta).
      if (mode === "move" && points.length && !ev.ctrlKey && !ev.metaKey) {
        const snapped = snapMove(Math.max(0, clip.start + dx), clip.duration, points, SNAP_PX / pxPerSec);
        if (snapped.at !== null) {
          dx = snapped.start - clip.start;
          snap = snapped.at;
        }
      } else if (mode !== "move" && points.length && !ev.ctrlKey && !ev.metaKey) {
        const edge = mode === "left" ? clip.start + dx : clipEnd(clip) + dx;
        const near = points.find((p) => Math.abs(p - edge) * pxPerSec <= SNAP_PX);
        if (near !== undefined) {
          dx += near - edge;
          snap = near;
        }
      }
      setDrag({ clipId: clip.id, mode, dx, snap });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setDrag(null);
      if (Math.abs(dx) * pxPerSec < 3) return;
      const { apply } = useEditor.getState();
      const g = preview(project, clip, { clipId: clip.id, mode, dx });
      if (clip.type === "media" && mode === "move") {
        // Posição livre (cria lacunas); solto sobre outro clip, encaixa entre os dois e empurra o resto.
        if (!apply([{ op: "move_clip", clipId: clip.id, start: round(g.start) }])) {
          const log = useEditor.getState().lastLog[0];
          if (log?.includes("inserido")) useEditor.getState().setNotice("Clip encaixado entre os clipes: os seguintes foram empurrados, nada foi sobrescrito.");
        }
      } else if (clip.type === "media") {
        apply([
          mode === "left"
            ? { op: "trim_clip", clipId: clip.id, sourceStart: round(clip.sourceStart + (g.start - clip.start)) }
            : { op: "trim_clip", clipId: clip.id, sourceEnd: round(clip.sourceStart + g.duration) },
        ]);
      } else {
        apply([{ op: "update_clip", clipId: clip.id, start: round(g.start), duration: round(g.duration) }]);
      }
      useEditor.getState().select(clip.id);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  /** Legenda: clique seleciona (abre o editor); arrastar adianta ou atrasa. */
  const startCaptionDrag = (e: React.PointerEvent, g: CaptionGroup) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let dx = 0;
    const s = useEditor.getState();
    s.selectCaption(g.wordIds);
    setSplitHint(false);
    const move = (ev: PointerEvent) => {
      dx = (ev.clientX - x0) / pxPerSec;
      if (Math.abs(ev.clientX - x0) >= 3) setCaptionDrag({ id: g.wordIds[0]!, dx });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setCaptionDrag(null);
      if (Math.abs(dx) * pxPerSec < 3) {
        s.seek(Math.max(0, g.start + 0.01));
        return;
      }
      const shift = Math.max(-5, Math.min(5, round(g.shift + dx)));
      if (!s.apply([{ op: "edit_caption", wordIds: g.wordIds, shift }])) useEditor.getState().selectCaption(g.wordIds);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const step = [0.5, 1, 2, 5, 10, 30, 60, 300].find((s) => s * pxPerSec >= 70) ?? 600;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);
  const fit = () => {
    const w = scroller.current?.clientWidth ?? 800;
    useEditor.getState().setPxPerSec(Math.max(8, Math.min(300, (w - PAD - 40) / Math.max(duration, 1))));
  };

  return (
    <div className="flex shrink-0 flex-col bg-ink-900" style={{ height }} data-testid="timeline">
      <ResizeHandle axis="y" label="Altura da timeline" onDrag={(d) => useEditor.getState().resize("bottom", -d)} onReset={() => useEditor.getState().resetLayout("bottom")} />
      <TimelineToolbar onFit={fit} snap={snapOn} onSnap={setSnapOn} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div
          ref={inner}
          className="relative min-h-full select-none"
          style={{ width, minWidth: "100%" }}
          onPointerDown={onAreaDown}
          onDragOver={(e) => {
            if (![...e.dataTransfer.types].some((t) => t === ASSET_DND || t === "Files")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            const target = dropTarget(e);
            if (!drop || drop.t !== target.t || drop.main !== target.main) setDrop(target);
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
          onDrop={onDrop}
          onPointerMove={(e) => {
            // Linha-guia sob o ponteiro, com o tempo: mostra onde o clique vai cair. Direto no DOM, sem redesenhar a timeline.
            const el = hover.current;
            if (!el || !inner.current) return;
            const x = e.clientX - inner.current.getBoundingClientRect().left;
            const t = (x - PAD) / pxPerSec;
            const show = t >= 0 && t <= duration && e.buttons === 0;
            el.style.opacity = show ? "1" : "0";
            el.style.transform = `translateX(${x}px)`;
            el.dataset.time = formatTime(Math.max(0, t));
            (el.firstElementChild as HTMLElement).textContent = formatTime(Math.max(0, t));
          }}
          onPointerLeave={() => hover.current && (hover.current.style.opacity = "0")}
          onDoubleClick={() => {
            // Duplo clique: desfaz a seleção e volta ao normal.
            const s = useEditor.getState();
            s.setRange(null);
            s.select(null);
            setSplitHint(false);
          }}
        >
          <div className="sticky top-0 z-20 flex h-7 cursor-text border-b border-line bg-ink-850/95 backdrop-blur" data-testid="ruler">
            <div className="sticky left-0 z-10 h-full shrink-0 border-r border-line bg-ink-850" style={{ width: LABEL }} />
            {ticks.map((t) => (
              <span key={t} className="pointer-events-none absolute top-0 h-full border-l border-white/10 pl-1.5 font-mono text-[10px] leading-7 text-zinc-500" style={{ left: PAD + t * pxPerSec }}>
                {formatTime(t)}
              </span>
            ))}
            {project.markers.map((m) => (
              <button
                key={m.id}
                data-testid="marker"
                title={`Marcador${m.label ? ` “${m.label}”` : ""} em ${formatTime(m.t)} — duplo clique remove`}
                onPointerDown={(e) => (e.stopPropagation(), useEditor.getState().seek(m.t))}
                onDoubleClick={(e) => (e.stopPropagation(), useEditor.getState().apply([{ op: "remove_marker", markerId: m.id }]))}
                className="absolute top-0 z-10 -ml-[6px] h-7 w-3 cursor-pointer"
                style={{ left: PAD + m.t * pxPerSec }}
              >
                <span className="mx-auto block h-3 w-3 rotate-45 rounded-[2px] bg-amber-300 shadow" />
              </button>
            ))}
          </div>

          {project.tracks.map((track) => (
            <div key={track.id} data-track-kind={track.kind} className={`relative border-b border-white/[0.04] ${track.kind === "main" ? "bg-white/[0.015]" : ""} ${drop && (drop.main ? track.kind === "main" : track.kind === "broll") ? "bg-brand-500/10" : ""}`} style={{ height: ROW[track.kind] }}>
              <TrackLabel kind={track.kind} name={track.name.replace("Motion", "Animações")} />
              {track.kind === "main" && !track.clips.length && (
                <span className="pointer-events-none absolute inset-y-0 flex items-center text-[11px] text-zinc-600" style={{ left: PAD }} data-testid="empty-main">
                  Trilha de vídeo vazia — arraste um vídeo para cá, ou componha só com textos, cards e sons.
                </span>
              )}
              {track.kind === "main" &&
                mainGaps(project).map((g) => (
                  <div
                    key={`gap-${g.start}`}
                    data-testid="gap"
                    title={`Lacuna de ${(g.end - g.start).toFixed(1)}s — solte uma mídia aqui, ou clique e use “Fechar lacuna”`}
                    className="pointer-events-none absolute bottom-1 top-1 rounded-lg border border-dashed border-zinc-700/80 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.03)_6px_12px)]"
                    style={{ left: PAD + g.start * pxPerSec, width: Math.max(2, (g.end - g.start) * pxPerSec) }}
                  />
                ))}
              {track.clips.map((clip) => {
                const g = drag?.clipId === clip.id ? preview(project, clip, drag) : clip;
                return (
                  <ClipBox
                    key={clip.id}
                    clip={clip}
                    project={project}
                    left={PAD + g.start * pxPerSec}
                    width={Math.max(4, g.duration * pxPerSec)}
                    pxPerSec={pxPerSec}
                    selected={selectedClipId === clip.id}
                    onDrag={(e, mode) => startClipDrag(e, clip, mode)}
                  />
                );
              })}
            </div>
          ))}

          {(project.music.mood !== "none" || project.music.assetId) && duration > 0 && (
            <div className="relative border-b border-white/[0.04]" style={{ height: 24 }} data-testid="music-track">
              <TrackLabel kind="audio" name="Trilha" />
              <div className="pointer-events-none absolute bottom-1 top-1 overflow-hidden rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 text-[10px] leading-4 text-cyan-100" style={{ left: PAD, width: duration * pxPerSec }}>
                {project.music.assetId ? (project.assets[project.music.assetId]?.name ?? "áudio") : MUSIC_NAMES[project.music.mood]}
                {project.music.duck ? " · ducking −14 dB sob a voz" : ""}
              </div>
            </div>
          )}

          {hasWords && (
            <div className="relative border-b border-white/[0.04]" style={{ height: ROW.captions }} data-testid="caption-track">
              <TrackLabel kind="captions" name="Legendas" muted={!project.captions.enabled} />
              {captions.map((g) => {
                const id = g.wordIds[0]!;
                const dx = captionDrag?.id === id ? captionDrag.dx : 0;
                const selected = selectedCaption?.[0] === id;
                return (
                  <div
                    key={id}
                    data-testid="caption-clip"
                    title={`${g.text || "(vazia)"} — ${g.doubtful.length ? "confira: a transcrição pode ter errado aqui. " : ""}clique para editar, arraste para mover`}
                    data-doubtful={g.doubtful.length ? "true" : undefined}
                    onPointerDown={(e) => startCaptionDrag(e, g)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`absolute bottom-1 top-1 cursor-grab overflow-hidden rounded-md border px-1.5 text-[10.5px] leading-[22px] transition-colors ${
                      g.hidden
                        ? "border-dashed border-zinc-700 bg-transparent text-zinc-600 line-through"
                        : g.doubtful.length && project.captions.enabled
                          ? "border-dashed border-amber-300/80 bg-amber-400/15 text-amber-50 hover:bg-amber-400/25"
                          : project.captions.enabled
                          ? "border-sky-400/40 bg-sky-400/15 text-sky-100 hover:bg-sky-400/25"
                          : "border-zinc-700 bg-zinc-800/60 text-zinc-500"
                    } ${selected ? "ring-2 ring-white" : ""}`}
                    style={{ left: PAD + (g.start + dx) * pxPerSec, width: Math.max(6, (g.end - g.start) * pxPerSec - 1) }}
                  >
                    <span className="pointer-events-none block truncate">{g.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {range && (
            <>
              <div
                key={`range-${aiFocus}`}
                className={`pointer-events-none absolute bottom-0 top-7 z-10 overflow-hidden border-x-2 border-brand-400 bg-brand-500/15 ${aiFocus ? "ai-sweep" : ""}`}
                style={{ left: PAD + range.start * pxPerSec, width: Math.max(2, (range.end - range.start) * pxPerSec) }}
                data-testid="range"
              />
              <RangeActions left={PAD + range.end * pxPerSec + 8} />
            </>
          )}
          {drag?.snap != null && <div className="pointer-events-none absolute bottom-0 top-7 z-30 w-px bg-amber-300" style={{ left: PAD + drag.snap * pxPerSec }} data-testid="snap-line" />}
          {drop && (
            <div className="pointer-events-none absolute bottom-0 top-7 z-30 w-0.5 bg-brand-300" style={{ left: PAD + drop.t * pxPerSec }} data-testid="drop-line">
              <span className="absolute left-2 top-1 whitespace-nowrap rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-medium text-white">{drop.main ? "Inserir no vídeo (empurra o que vem depois)" : "Sobrepor (b-roll)"}</span>
            </div>
          )}
          <div ref={hover} className="pointer-events-none absolute bottom-0 left-0 top-0 z-20 w-px bg-white/25 opacity-0 transition-opacity">
            <span className="absolute left-1.5 top-1 rounded bg-ink-700 px-1 py-px font-mono text-[9.5px] text-zinc-200 shadow" />
          </div>
          <Playhead pxPerSec={pxPerSec} splitHint={splitHint && !range} onSplit={() => (splitAtPlayhead(), setSplitHint(false))} />
        </div>
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;

const TRACK_STYLE: Record<Track["kind"] | "captions", { icon: React.ReactNode; color: string }> = {
  overlay: { icon: <Icon.layers size={12} />, color: "text-emerald-300" },
  broll: { icon: <Icon.film size={12} />, color: "text-rose-300" },
  fx: { icon: <Icon.zoomIn size={12} />, color: "text-amber-300" },
  main: { icon: <Icon.film size={12} />, color: "text-brand-300" },
  audio: { icon: <Icon.mic size={12} />, color: "text-cyan-300" },
  captions: { icon: <Icon.captions size={12} />, color: "text-sky-300" },
};

function TrackLabel({ kind, name, muted }: { kind: Track["kind"] | "captions"; name: string; muted?: boolean }) {
  const st = TRACK_STYLE[kind];
  return (
    <div
      className={`pointer-events-none sticky left-0 z-10 flex h-full items-center gap-1.5 border-r border-line bg-ink-900 px-2 text-[10.5px] font-medium tracking-wide ${muted ? "text-zinc-600" : st.color}`}
      style={{ width: LABEL }}
    >
      {st.icon}
      <span className="truncate text-zinc-400">{name}</span>
    </div>
  );
}

/** Ações do trecho selecionado, coladas na borda da seleção. */
function RangeActions({ left }: { left: number }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const btn = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition";
  return (
    <div className="pop-in absolute top-9 z-40 flex items-center gap-1 rounded-xl border border-line-strong bg-ink-800/95 p-1 shadow-2xl backdrop-blur" style={{ left }} onPointerDown={stop} onDoubleClick={stop} data-testid="range-actions">
      <button className={`${btn} text-rose-200 hover:bg-rose-500/20`} onClick={() => deleteSelection()} title="Cortar este trecho (Delete)" data-testid="range-cut">
        <Icon.scissors size={15} /> Cortar
      </button>
      <button className={`${btn} btn-brand`} onClick={() => useEditor.getState().focusAI()} title="Pedir ao Diretor de IA uma edição só neste trecho" data-testid="range-ai">
        <Icon.sparkles size={15} /> Editar com IA
      </button>
      <button className={`${btn} px-2 text-zinc-400 hover:bg-white/10 hover:text-white`} onClick={() => useEditor.getState().setRange(null)} title="Cancelar seleção (Esc ou duplo clique)" aria-label="Cancelar seleção">
        <Icon.x size={14} />
      </button>
    </div>
  );
}

/** Geometria do clip durante o arraste, já com os limites aplicados. */
function preview(project: Project, clip: Clip, drag: Drag): { start: number; duration: number } {
  const { mode, dx } = drag;
  if (clip.type === "media" && mode === "move") return { start: Math.max(0, clip.start + dx), duration: clip.duration };
  if (clip.type === "media") {
    const asset = project.assets[clip.assetId];
    const max = asset?.duration ?? clip.sourceStart + clip.duration;
    if (mode === "left") {
      const d = Math.max(-clip.sourceStart, Math.min(dx, clip.duration - MIN_LEN));
      return { start: clip.start + d, duration: clip.duration - d };
    }
    const d = Math.max(MIN_LEN - clip.duration, Math.min(dx, max - (clip.sourceStart + clip.duration)));
    return { start: clip.start, duration: clip.duration + d };
  }
  // Vídeo de contexto não estica além do material que existe.
  const cap = clip.type === "broll" && project.assets[clip.assetId]?.kind !== "image" ? (project.assets[clip.assetId]?.duration ?? Infinity) - clip.sourceStart : Infinity;
  if (mode === "move") return { start: Math.max(0, clip.start + dx), duration: clip.duration };
  if (mode === "left") {
    const d = Math.max(-clip.start, Math.min(dx, clip.duration - MIN_LEN));
    return { start: clip.start + d, duration: clip.duration - d };
  }
  return { start: clip.start, duration: Math.min(cap, Math.max(MIN_LEN, clip.duration + dx)) };
}

const STYLES: Record<Clip["type"], string> = {
  media: "bg-gradient-to-b from-brand-500/35 to-brand-600/20 border-brand-400/50 text-brand-300",
  zoom: "bg-amber-400/20 border-amber-300/50 text-amber-100 hover:bg-amber-400/30",
  component: "bg-emerald-400/20 border-emerald-300/50 text-emerald-100 hover:bg-emerald-400/30",
  broll: "bg-rose-400/20 border-rose-300/50 text-rose-100 hover:bg-rose-400/30",
  sfx: "bg-cyan-400/20 border-cyan-300/50 text-cyan-100 hover:bg-cyan-400/30",
  impact: "bg-orange-400/25 border-orange-300/60 text-orange-100 hover:bg-orange-400/35",
};

function ClipBox(props: { clip: Clip; project: Project; left: number; width: number; pxPerSec: number; selected: boolean; onDrag: (e: React.PointerEvent, mode: DragMode) => void }) {
  const { clip, project } = props;
  const label =
    clip.type === "media" || clip.type === "broll"
      ? (project.assets[clip.assetId]?.name ?? "vídeo")
      : clip.type === "zoom"
        ? `Zoom ${clip.scale}×`
        : clip.type === "sfx"
          ? clip.sfx.replace(/_/g, " ")
          : clip.type === "impact"
            ? "Impacto"
            : (COMPONENTS[clip.component]?.name ?? clip.component);
  const speed = clip.type === "media" && hasSpeed(clip) ? (clip.speedRamp ? `rampa ${rateAverage(clip).toFixed(2)}×` : `${clip.speed}×`) : null;
  return (
    <div
      data-testid={`clip-${clip.type}`}
      data-clip-id={clip.id}
      {...(clip.type === "media" ? { "data-media-clip": "" } : {})}
      className={`absolute bottom-1 top-1 overflow-hidden rounded-lg border text-[11px] transition-colors ${STYLES[clip.type]} ${props.selected ? "ring-2 ring-white" : ""} ${
        clip.type === "media" ? "cursor-text" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ left: props.left, width: props.width }}
      onPointerDown={(e) => props.onDrag(e, "move")}
      onDoubleClick={clip.type === "media" ? undefined : (e) => e.stopPropagation()}
      title={clip.type === "media" ? `${label} — arraste pela barra do nome para mover (ou Alt+arrastar); clique marca um instante; arrastar no corpo seleciona um trecho` : `${label} — ${clip.duration.toFixed(2)}s · clique para editar`}
    >
      {clip.type === "media" && <Waveform clip={clip} width={props.width} pxPerSec={props.pxPerSec} />}
      {clip.type === "media" ? (
        <span data-grip className="relative flex h-[22px] cursor-grab items-center gap-1 truncate bg-black/25 px-2 leading-[22px] active:cursor-grabbing" data-testid="clip-grip">
          <Icon.move size={11} className="shrink-0 opacity-70" />
          <span className="pointer-events-none truncate drop-shadow">
            {label} <span className="opacity-60">{clip.duration.toFixed(1)}s</span>
            {speed && <span className="ml-1.5 rounded bg-amber-300/90 px-1 text-[9.5px] font-semibold text-black">{speed}</span>}
          </span>
        </span>
      ) : (
        <span className="pointer-events-none relative block truncate px-2 leading-6 drop-shadow">
          {label} {clip.type !== "sfx" && <span className="opacity-60">{clip.duration.toFixed(1)}s</span>}
        </span>
      )}
      <span className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize rounded-l-lg bg-white/0 hover:bg-white/70" onPointerDown={(e) => props.onDrag(e, "left")} />
      <span className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize rounded-r-lg bg-white/0 hover:bg-white/70" onPointerDown={(e) => props.onDrag(e, "right")} />
    </div>
  );
}

/** Forma de onda do trecho do áudio que este clip usa: mostra onde estão as pausas. */
function Waveform({ clip, width, pxPerSec }: { clip: MediaClip; width: number; pxPerSec: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = peaksFor(clip.assetId);
  const w = Math.min(8000, Math.max(1, Math.round(width)));
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const h = canvas.height;
    ctx.clearRect(0, 0, canvas.width, h);
    if (!peaks) return;
    ctx.fillStyle = "rgba(196,184,255,0.55)";
    const secPerPx = 1 / pxPerSec;
    for (let x = 0; x < canvas.width; x++) {
      // Com velocidade, a forma de onda segue a curva do clip (estica na câmera lenta).
      const a = Math.floor(sourceTimeAt(clip, x * secPerPx) * PEAKS_PER_SEC);
      const b = Math.max(a + 1, Math.floor(sourceTimeAt(clip, (x + 1) * secPerPx) * PEAKS_PER_SEC));
      let peak = 0;
      for (let i = a; i < b && i < peaks.length; i++) peak = Math.max(peak, peaks[i]!);
      const bar = Math.max(1, peak * (h - 6));
      ctx.fillRect(x, h - bar, 1, bar);
    }
  }, [peaks, clip, w, pxPerSec]);
  return <canvas ref={ref} width={w} height={30} className="pointer-events-none absolute inset-x-0 bottom-0 h-[30px] w-full opacity-90" />;
}

function Playhead({ pxPerSec, splitHint, onSplit }: { pxPerSec: number; splitHint: boolean; onSplit: () => void }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  // Só há o que dividir no meio de um clip.
  const canSplit = useEditor((s) => {
    const c = s.project ? mainClipAt(s.project, s.time) : null;
    return !!c && s.time > c.start + MIN_CLIP && s.time < clipEnd(c) - MIN_CLIP;
  });
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-rose-400" style={{ left: PAD + time * pxPerSec }} data-testid="playhead">
      <div className="-ml-[6px] h-3.5 w-[13px] rounded-b-md bg-rose-400 shadow" />
      {splitHint && canSplit && !playing && (
        <button
          onPointerDown={stop}
          onDoubleClick={stop}
          onClick={onSplit}
          title="Dividir o clip aqui (S)"
          data-testid="split-here"
          className="pop-in pointer-events-auto absolute left-2 top-9 flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-ink-800/95 px-2.5 text-xs font-medium text-zinc-100 shadow-2xl backdrop-blur hover:border-brand-400 hover:text-white"
        >
          <Icon.split size={15} className="text-brand-300" /> Dividir aqui
        </button>
      )}
    </div>
  );
}

function TimelineToolbar({ onFit, snap, onSnap }: { onFit: () => void; snap: boolean; onSnap: (v: boolean) => void }) {
  const inGap = useEditor((s) => !!s.project && mainGaps(s.project).some((g) => s.time >= g.start - 0.001 && s.time < g.end));
  const mainSelected = useEditor((s) => !!s.project && !!s.selectedClipId && s.project.tracks.some((t) => t.kind === "main" && t.clips.some((c) => c.id === s.selectedClipId)));
  const range = useEditor((s) => s.range);
  const selected = useEditor((s) => s.selectedClipId);
  const caption = useEditor((s) => s.selectedCaption);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const setPxPerSec = useEditor((s) => s.setPxPerSec);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo } = useEditor.getState();
  const tool = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-300";
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <div className="flex items-center rounded-xl border border-line bg-ink-850 p-0.5" role="group" aria-label="Histórico">
        <button className={tool} onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" data-testid="undo">
          <Icon.undo size={15} /> Desfazer
        </button>
        <span className="h-4 w-px bg-line" />
        <button className={tool} onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)" data-testid="redo">
          Refazer <Icon.redo size={15} />
        </button>
      </div>
      <span className="mx-1 h-5 w-px bg-line" />
      <button className={tool} onClick={splitAtPlayhead} title="Dividir no cursor (S)">
        <Icon.split size={15} /> Dividir
      </button>
      <button className={tool} onClick={() => deleteSelection()} disabled={!range && !selected && !caption} title={mainSelected ? "Ripple delete: apaga e fecha o buraco (Delete). Shift+Delete deixa a lacuna." : "Apagar (Delete)"} data-testid="ripple-delete">
        <Icon.trash size={15} /> {range ? "Cortar trecho" : caption ? "Remover legenda" : mainSelected ? "Ripple delete" : "Apagar"}
      </button>
      {mainSelected && (
        <button className={tool} onClick={() => deleteSelection(true)} title="Apaga o clip e deixa a lacuna (Shift+Delete)" data-testid="lift">
          Deixar lacuna
        </button>
      )}
      {inGap && (
        <button className={tool} onClick={closeGapAtPlayhead} title="Fecha a lacuna sob o cursor: o que vem depois recua" data-testid="close-gap">
          Fechar lacuna
        </button>
      )}
      <button className={tool} onClick={addMarkerAtPlayhead} title="Marcador no cursor (M) — as bordas grudam nele">
        Marcador
      </button>
      <button className={`${tool} ${snap ? "!text-amber-200" : ""}`} onClick={() => onSnap(!snap)} aria-pressed={snap} title="Snapping magnético nas bordas dos clips, no cursor e nos marcadores (segure Ctrl para soltar)" data-testid="snap-toggle">
        Ímã {snap ? "ligado" : "desligado"}
      </button>
      {range ? (
        <span className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] text-brand-300" data-testid="range-info">
          {formatTime(range.start)} – {formatTime(range.end)} · {(range.end - range.start).toFixed(1)}s
        </span>
      ) : (
        <span className="hidden truncate text-[11px] text-zinc-600 2xl:block">Arraste a barra do nome para mover o clip · arraste no corpo seleciona um trecho · edição manual é grátis</span>
      )}
      <div className="ml-auto flex items-center gap-2 text-zinc-500">
        <button className={tool} onClick={onFit} title="Ajustar a timeline à largura da tela">
          <Icon.fit size={15} /> Ajustar
        </button>
        <Icon.zoomIn size={14} />
        <input type="range" min={8} max={300} value={pxPerSec} onChange={(e) => setPxPerSec(Number(e.target.value))} className="w-28" aria-label="Zoom da timeline" />
      </div>
    </div>
  );
}
