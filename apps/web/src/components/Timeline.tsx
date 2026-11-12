"use client";

import { useEffect, useRef, useState } from "react";
import { clipEnd, mainClipAt, MIN_CLIP, projectDuration, type Clip, type MediaClip, type Project, type Track } from "@videoeditor/core";
import { captionGroups, COMPONENTS, type CaptionGroup } from "@videoeditor/renderer";
import { useEditor } from "@/lib/store";
import { loadPeaks, PEAKS_PER_SEC, peaksFor } from "@/lib/waveform";
import { formatTime } from "./Player";
import { Icon, ResizeHandle } from "./ui";

/** Largura da coluna com o nome das trilhas. */
const LABEL = 78;
const PAD = LABEL + 12;
const MIN_LEN = 0.2;
const ROW: Record<Track["kind"] | "captions", number> = { overlay: 34, broll: 40, fx: 34, main: 60, captions: 32 };

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
  } else if (s.selectedCaption) {
    if (!s.apply([{ op: "edit_caption", wordIds: s.selectedCaption, hidden: true }])) s.selectCaption(null);
  } else if (s.selectedClipId) {
    if (!s.apply([{ op: "delete_clip", clipId: s.selectedClipId }])) s.select(null);
  }
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
    // O corpo do clip de vídeo não se move (trilha magnética): cai no handler da área, que seleciona trecho.
    if (clip.type === "media" && mode === "move") return;
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
      <TimelineToolbar onFit={fit} />
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div
          ref={inner}
          className="relative min-h-full select-none"
          style={{ width, minWidth: "100%" }}
          onPointerDown={onAreaDown}
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
          </div>

          {project.tracks.map((track) => (
            <div key={track.id} className={`relative border-b border-white/[0.04] ${track.kind === "main" ? "bg-white/[0.015]" : ""}`} style={{ height: ROW[track.kind] }}>
              <TrackLabel kind={track.kind} name={track.name} />
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
                    title={`${g.text || "(vazia)"} — clique para editar, arraste para mover`}
                    onPointerDown={(e) => startCaptionDrag(e, g)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`absolute bottom-1 top-1 cursor-grab overflow-hidden rounded-md border px-1.5 text-[10.5px] leading-[22px] transition-colors ${
                      g.hidden
                        ? "border-dashed border-zinc-700 bg-transparent text-zinc-600 line-through"
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
      <button className={`${btn} text-rose-200 hover:bg-rose-500/20`} onClick={deleteSelection} title="Cortar este trecho (Delete)" data-testid="range-cut">
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
};

function ClipBox(props: { clip: Clip; project: Project; left: number; width: number; pxPerSec: number; selected: boolean; onDrag: (e: React.PointerEvent, mode: DragMode) => void }) {
  const { clip, project } = props;
  const label =
    clip.type === "media" || clip.type === "broll"
      ? (project.assets[clip.assetId]?.name ?? "vídeo")
      : clip.type === "zoom"
        ? `Zoom ${clip.scale}×`
        : (COMPONENTS[clip.component]?.name ?? clip.component);
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
      title={clip.type === "media" ? `${label} — clique marca um instante, arraste seleciona um trecho` : `${label} — ${clip.duration.toFixed(2)}s · clique para editar`}
    >
      {clip.type === "media" && <Waveform clip={clip} width={props.width} pxPerSec={props.pxPerSec} />}
      <span className="pointer-events-none relative block truncate px-2 leading-6 drop-shadow">
        {label} <span className="opacity-60">{clip.duration.toFixed(1)}s</span>
      </span>
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
      const a = Math.floor((clip.sourceStart + x * secPerPx) * PEAKS_PER_SEC);
      const b = Math.max(a + 1, Math.floor((clip.sourceStart + (x + 1) * secPerPx) * PEAKS_PER_SEC));
      let peak = 0;
      for (let i = a; i < b && i < peaks.length; i++) peak = Math.max(peak, peaks[i]!);
      const bar = Math.max(1, peak * (h - 6));
      ctx.fillRect(x, h - bar, 1, bar);
    }
  }, [peaks, clip.sourceStart, w, pxPerSec]);
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

function TimelineToolbar({ onFit }: { onFit: () => void }) {
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
      <button className={tool} onClick={deleteSelection} disabled={!range && !selected && !caption} title="Apagar (Delete)">
        <Icon.trash size={15} /> {range ? "Cortar trecho" : caption ? "Remover legenda" : "Apagar"}
      </button>
      {range ? (
        <span className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] text-brand-300" data-testid="range-info">
          {formatTime(range.start)} – {formatTime(range.end)} · {(range.end - range.start).toFixed(1)}s
        </span>
      ) : (
        <span className="hidden truncate text-[11px] text-zinc-600 xl:block">Clique marca um instante · arraste seleciona um trecho · duplo clique cancela · edição manual é grátis</span>
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
