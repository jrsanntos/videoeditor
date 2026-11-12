"use client";

import { useRef, useState } from "react";
import { clipEnd, projectDuration, type Clip, type Project, type Track } from "@videoeditor/core";
import { COMPONENTS } from "@videoeditor/renderer";
import { useEditor } from "@/lib/store";
import { formatTime } from "./Player";

const PAD = 16;
const MIN_LEN = 0.2;

type DragMode = "move" | "left" | "right";
type Drag = { clipId: string; mode: DragMode; dx: number };

export function splitAtPlayhead() {
  const s = useEditor.getState();
  s.apply([{ op: "split", time: s.time }]);
}

export function deleteSelection() {
  const s = useEditor.getState();
  if (s.range) {
    if (!s.apply([{ op: "remove_ranges", ranges: [s.range] }])) {
      s.seek(s.range.start);
      s.setRange(null);
    }
  } else if (s.selectedClipId) {
    if (!s.apply([{ op: "delete_clip", clipId: s.selectedClipId }])) s.select(null);
  }
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const range = useEditor((s) => s.range);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const inner = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  if (!project) return null;
  const duration = projectDuration(project);
  const width = duration * pxPerSec + PAD * 2 + 200;
  const timeAt = (clientX: number) =>
    Math.max(0, Math.min(duration, (clientX - inner.current!.getBoundingClientRect().left - PAD) / pxPerSec));

  /** Régua: clique = posiciona; arrastar = seleciona um trecho (contexto para corte ou IA). */
  const onRulerDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const t0 = timeAt(x0);
    let dragged = false;
    const s = useEditor.getState();
    s.setPlaying(false);
    s.seek(t0);
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 5) return;
      dragged = true;
      const t1 = timeAt(ev.clientX);
      s.setRange({ start: round(Math.min(t0, t1)), end: round(Math.max(t0, t1)) });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      const r = useEditor.getState().range;
      if (!dragged || (r && r.end - r.start < 0.1)) s.setRange(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const startClipDrag = (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => {
    e.stopPropagation();
    if (clip.type === "media" && mode === "move") {
      useEditor.getState().select(clip.id);
      return; // trilha principal é magnética: clips não se movem livremente
    }
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let dx = 0;
    useEditor.getState().select(clip.id);
    const move = (ev: PointerEvent) => {
      dx = (ev.clientX - x0) / pxPerSec;
      setDrag({ clipId: clip.id, mode, dx });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      setDrag(null);
      if (Math.abs(dx) * pxPerSec < 3) return;
      const { apply } = useEditor.getState();
      const g = preview(project, clip, { clipId: clip.id, mode, dx });
      if (clip.type === "media") {
        apply([
          mode === "left"
            ? { op: "trim_clip", clipId: clip.id, sourceStart: round(clip.sourceStart + (g.start - clip.start)) }
            : { op: "trim_clip", clipId: clip.id, sourceEnd: round(clip.sourceStart + g.duration) },
        ]);
      } else {
        apply([{ op: "update_clip", clipId: clip.id, start: round(g.start), duration: round(g.duration) }]);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    void track;
  };

  const step = [0.5, 1, 2, 5, 10, 30, 60, 300].find((s) => s * pxPerSec >= 70) ?? 600;
  const ticks = Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step);

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950" data-testid="timeline">
      <TimelineToolbar />
      <div className="min-h-0 flex-1 overflow-auto">
        <div ref={inner} className="relative min-h-full select-none" style={{ width }}>
          <div
            className="sticky top-0 z-20 h-7 cursor-col-resize border-b border-zinc-800 bg-zinc-900/95"
            onPointerDown={onRulerDown}
            data-testid="ruler"
          >
            {ticks.map((t) => (
              <span
                key={t}
                className="pointer-events-none absolute top-0 h-full border-l border-zinc-700 pl-1 text-[10px] leading-7 text-zinc-500"
                style={{ left: PAD + t * pxPerSec }}
              >
                {formatTime(t)}
              </span>
            ))}
          </div>

          {project.tracks.map((track) => (
            <div
              key={track.id}
              className="relative h-12 border-b border-zinc-900"
              onPointerDown={(e) => {
                const s = useEditor.getState();
                s.select(null);
                s.seek(timeAt(e.clientX));
              }}
            >
              <span className="pointer-events-none sticky left-2 top-0 z-10 inline-block pt-0.5 text-[10px] uppercase tracking-wide text-zinc-600">
                {track.name}
              </span>
              {track.clips.map((clip) => {
                const g = drag?.clipId === clip.id ? preview(project, clip, drag) : clip;
                return (
                  <ClipBox
                    key={clip.id}
                    clip={clip}
                    project={project}
                    left={PAD + g.start * pxPerSec}
                    width={Math.max(4, g.duration * pxPerSec)}
                    selected={selectedClipId === clip.id}
                    onDrag={(e, mode) => startClipDrag(e, clip, track, mode)}
                  />
                );
              })}
            </div>
          ))}

          {range && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-10 border-x border-sky-400 bg-sky-400/15"
              style={{ left: PAD + range.start * pxPerSec, width: (range.end - range.start) * pxPerSec }}
              data-testid="range"
            />
          )}
          <Playhead pxPerSec={pxPerSec} />
        </div>
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Geometria do clip durante o arraste, já com os limites aplicados. */
function preview(project: Project, clip: Clip, drag: Drag): { start: number; duration: number } {
  const { mode, dx } = drag;
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
  if (mode === "move") return { start: Math.max(0, clip.start + dx), duration: clip.duration };
  if (mode === "left") {
    const d = Math.max(-clip.start, Math.min(dx, clip.duration - MIN_LEN));
    return { start: clip.start + d, duration: clip.duration - d };
  }
  return { start: clip.start, duration: Math.max(MIN_LEN, clip.duration + dx) };
}

const STYLES: Record<Clip["type"], string> = {
  media: "bg-indigo-500/25 border-indigo-400/60 text-indigo-100",
  zoom: "bg-amber-500/25 border-amber-400/60 text-amber-100",
  component: "bg-emerald-500/25 border-emerald-400/60 text-emerald-100",
};

function ClipBox(props: {
  clip: Clip;
  project: Project;
  left: number;
  width: number;
  selected: boolean;
  onDrag: (e: React.PointerEvent, mode: DragMode) => void;
}) {
  const { clip, project } = props;
  const label =
    clip.type === "media"
      ? (project.assets[clip.assetId]?.name ?? "vídeo")
      : clip.type === "zoom"
        ? `Zoom ${clip.scale}×`
        : (COMPONENTS[clip.component]?.name ?? clip.component);
  return (
    <div
      data-testid={`clip-${clip.type}`}
      data-clip-id={clip.id}
      className={`absolute bottom-1 top-4 overflow-hidden rounded-md border text-[11px] ${STYLES[clip.type]} ${
        props.selected ? "ring-2 ring-white" : ""
      } ${clip.type === "media" ? "cursor-pointer" : "cursor-grab"}`}
      style={{ left: props.left, width: props.width }}
      onPointerDown={(e) => props.onDrag(e, "move")}
      onDoubleClick={() => useEditor.getState().setRange({ start: clip.start, end: clipEnd(clip) })}
      title={`${label} — ${clip.duration.toFixed(2)}s (duplo clique seleciona o trecho)`}
    >
      <span className="pointer-events-none block truncate px-2 leading-6">
        {label} <span className="opacity-60">{clip.duration.toFixed(1)}s</span>
      </span>
      <span
        className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/60"
        onPointerDown={(e) => props.onDrag(e, "left")}
      />
      <span
        className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/60"
        onPointerDown={(e) => props.onDrag(e, "right")}
      />
    </div>
  );
}

function Playhead({ pxPerSec }: { pxPerSec: number }) {
  const time = useEditor((s) => s.time);
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-rose-500"
      style={{ left: PAD + time * pxPerSec }}
    >
      <div className="-ml-1.5 h-3 w-3 rounded-b-sm bg-rose-500" />
    </div>
  );
}

function TimelineToolbar() {
  const range = useEditor((s) => s.range);
  const selected = useEditor((s) => s.selectedClipId);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const setPxPerSec = useEditor((s) => s.setPxPerSec);
  const btn =
    "rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800 px-3">
      <button className={btn} onClick={splitAtPlayhead} title="Dividir no cursor (S)">
        Dividir
      </button>
      <button className={btn} onClick={deleteSelection} disabled={!range && !selected} title="Apagar (Delete)">
        {range ? "Cortar trecho" : "Apagar clip"}
      </button>
      {range ? (
        <span className="rounded-md bg-sky-500/15 px-2 py-1 text-xs text-sky-300">
          Trecho {formatTime(range.start)}–{formatTime(range.end)} · peça à IA no chat ou corte
          <button className="ml-2 text-sky-200 hover:text-white" onClick={() => useEditor.getState().setRange(null)}>
            ✕
          </button>
        </span>
      ) : (
        <span className="text-xs text-zinc-600">Arraste na régua para selecionar um trecho · edição manual não gasta créditos</span>
      )}
      <label className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
        Zoom
        <input
          type="range"
          min={8}
          max={300}
          value={pxPerSec}
          onChange={(e) => setPxPerSec(Number(e.target.value))}
          className="w-28 accent-zinc-400"
        />
      </label>
    </div>
  );
}
