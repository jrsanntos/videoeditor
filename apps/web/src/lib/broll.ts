"use client";

import type { BrollClip, Project } from "@videoeditor/core";
import type { FrameSource } from "@videoeditor/renderer";
import { mediaBlob, mediaUrl } from "./media";

/**
 * Mídia de contexto no preview: um <video> mudo por asset (ou a imagem já
 * decodificada), mantido em sincronia com o tempo da timeline. O áudio do
 * vídeo falado nunca é interrompido: o b-roll só fornece quadros.
 */
const videos = new Map<string, HTMLVideoElement>();
const images = new Map<string, ImageBitmap | null>();

function videoFor(assetId: string): HTMLVideoElement | null {
  let v = videos.get(assetId);
  if (!v) {
    const url = mediaUrl(assetId);
    if (!url) return null;
    v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url;
    videos.set(assetId, v);
  }
  return v;
}

function imageFor(assetId: string): ImageBitmap | null {
  if (!images.has(assetId)) {
    images.set(assetId, null);
    const blob = mediaBlob(assetId);
    if (blob)
      void createImageBitmap(blob)
        .then((bmp) => images.set(assetId, bmp))
        .catch(() => images.delete(assetId));
  }
  return images.get(assetId) ?? null;
}

const brollClips = (project: Project): BrollClip[] => project.tracks.flatMap((t) => t.clips).filter((c): c is BrollClip => c.type === "broll");

/** A cada quadro do preview: toca os vídeos de contexto que estão na tela, prepara os próximos e pausa o resto. */
export function syncBroll(project: Project, t: number, playing: boolean) {
  const wanted = new Set<string>();
  for (const c of brollClips(project)) {
    const asset = project.assets[c.assetId];
    if (!asset || asset.kind === "image") continue;
    const active = t >= c.start && t < c.start + c.duration;
    const soon = !active && c.start > t && c.start - t < 1.5;
    if (!active && !soon) continue;
    const v = videoFor(c.assetId);
    if (!v) continue;
    wanted.add(c.assetId);
    const target = active ? c.sourceStart + (t - c.start) : c.sourceStart;
    if (active && playing) {
      if (Math.abs(v.currentTime - target) > 0.35 && !v.seeking) v.currentTime = target;
      if (v.paused && !v.seeking) void v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    }
  }
  for (const [id, v] of videos) if (!wanted.has(id) && !v.paused) v.pause();
}

/** Quadro atual de um clip de contexto para o compositor. */
export function brollFrame(project: Project, clip: BrollClip): FrameSource | null {
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  if (asset.kind === "image") {
    const bmp = imageFor(clip.assetId);
    return bmp ? { image: bmp, width: bmp.width, height: bmp.height } : null;
  }
  const v = videoFor(clip.assetId);
  return v && v.readyState >= 2 && v.videoWidth ? { image: v, width: v.videoWidth, height: v.videoHeight } : null;
}

export function clearBroll() {
  for (const v of videos.values()) {
    v.pause();
    v.removeAttribute("src");
    v.load();
  }
  videos.clear();
  for (const bmp of images.values()) bmp?.close();
  images.clear();
}

export function forgetBroll(assetId: string) {
  const v = videos.get(assetId);
  if (v) {
    v.pause();
    v.removeAttribute("src");
    v.load();
    videos.delete(assetId);
  }
  images.get(assetId)?.close();
  images.delete(assetId);
}
