"use client";

import { useEffect, useRef } from "react";
import { mainClipAt, projectDuration } from "@videoeditor/core";
import { renderFrame } from "@videoeditor/renderer";
import { mediaUrl } from "@/lib/media";
import { useEditor } from "@/lib/store";

export const formatTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

/**
 * Preview em tempo real: um <video> oculto fornece os quadros de origem e o
 * canvas é redesenhado a cada frame por `renderFrame` a partir do estado.
 * Nenhum pixel é renderizado no servidor.
 */
export function Player() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let raf = 0;
    let activeClipId: string | null = null;
    let engineTime = -1;
    let lastWall = performance.now();

    const tick = (now: number) => {
      const s = useEditor.getState();
      const p = s.project;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (p && video && canvas) {
        if (canvas.width !== p.width || canvas.height !== p.height) {
          canvas.width = p.width;
          canvas.height = p.height;
        }
        const duration = projectDuration(p);
        let t = Math.min(s.time, duration);
        // Tempo alterado fora do motor (clique, edição) → ressincroniza o vídeo.
        if (t !== engineTime) activeClipId = null;

        const clip = mainClipAt(p, t) ?? (t >= duration && duration > 0 ? mainClipAt(p, duration - 0.001) : null);
        if (clip) {
          const url = mediaUrl(clip.assetId);
          if (url && video.dataset.asset !== clip.assetId) {
            video.src = url;
            video.dataset.asset = clip.assetId;
            activeClipId = null;
          }
          const target = clip.sourceStart + Math.min(t - clip.start, clip.duration - 0.001);
          if (s.playing) {
            video.volume = Math.min(1, clip.volume);
            if (clip.id !== activeClipId) {
              activeClipId = clip.id;
              if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target;
            } else if (!video.seeking && video.readyState >= 2) {
              if (video.paused) void video.play().catch(() => useEditor.getState().setPlaying(false));
              // O relógio da timeline segue o relógio do vídeo (áudio sempre em sincronia).
              t = Math.min(clip.start + Math.max(0, video.currentTime - clip.sourceStart), clip.start + clip.duration);
            }
          } else {
            activeClipId = null;
            if (!video.paused) video.pause();
            if (!video.seeking && Math.abs(video.currentTime - target) > 0.02) video.currentTime = target;
          }
        } else {
          activeClipId = null;
          if (!video.paused) video.pause();
          if (s.playing) t += (now - lastWall) / 1000;
        }

        if (s.playing && t >= duration) {
          t = duration;
          video.pause();
          useEditor.setState({ playing: false });
        }
        if (t !== s.time) useEditor.setState({ time: t });
        engineTime = t;

        const ctx = canvas.getContext("2d");
        if (ctx)
          renderFrame(ctx, p, t, (c) =>
            video.readyState >= 2 && video.dataset.asset === c.assetId
              ? { image: video, width: video.videoWidth, height: video.videoHeight }
              : null,
          );
      }
      lastWall = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <canvas
          ref={canvasRef}
          data-testid="preview"
          className="max-h-full max-w-full rounded-lg bg-black shadow-2xl shadow-black/60"
          onClick={togglePlay}
        />
      </div>
      <video ref={videoRef} playsInline preload="auto" className="pointer-events-none fixed h-px w-px opacity-0" />
      <Transport />
    </div>
  );
}

export function togglePlay() {
  const s = useEditor.getState();
  if (!s.project) return;
  if (!s.playing && s.time >= projectDuration(s.project) - 0.01) s.seek(0);
  s.setPlaying(!s.playing);
}

function Transport() {
  const playing = useEditor((s) => s.playing);
  const time = useEditor((s) => s.time);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        onClick={togglePlay}
        aria-label={playing ? "Pausar" : "Reproduzir"}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="font-mono tabular-nums text-zinc-300" data-testid="timecode">
        {formatTime(time)} <span className="text-zinc-600">/ {formatTime(duration)}</span>
      </span>
    </div>
  );
}
