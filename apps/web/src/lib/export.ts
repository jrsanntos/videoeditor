"use client";

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from "mediabunny";
import { mainClips, projectDuration, type Project } from "@videoeditor/core";
import { drawWatermark, personIntervals, renderFrame, soundEvents, type FrameSource } from "@videoeditor/renderer";
import { loadProjectFonts } from "./fonts";
import { mediaBlob } from "./media";
import { ensureSegmenter, maskKey, personMask } from "./segmentation";
import { scheduleSfx } from "./sfx";

/**
 * Exportação local via WebCodecs: decodifica, compõe e codifica o vídeo final
 * na máquina do usuário, com o mesmo `renderFrame` do preview.
 * Custo de nuvem: zero. Custo em créditos: zero.
 */
export async function exportInBrowser(
  project: Project,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  /** Travas do plano: lado menor máximo do arquivo e marca d'água. */
  limits: { maxShortSide: number; watermark: boolean } = { maxShortSide: Infinity, watermark: false },
): Promise<{ blob: Blob; extension: string }> {
  if (typeof VideoEncoder === "undefined")
    throw new Error("Este navegador não suporta exportação local (WebCodecs). Use Chrome ou Edge recentes.");

  const { fps } = project;
  // O quadro é sempre composto na resolução do projeto; o arquivo sai reduzido se o plano limitar.
  const scale = Math.min(1, limits.maxShortSide / Math.min(project.width, project.height));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = even(project.width * scale);
  const height = even(project.height * scale);
  const duration = projectDuration(project);
  const clips = mainClips(project);
  if (!clips.length || duration <= 0) throw new Error("A timeline está vazia.");

  // MP4/H.264 quando o navegador codifica; senão WebM/VP9.
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
  let videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height });
  if (!videoCodec) {
    format = new WebMOutputFormat();
    videoCodec = await getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height });
  }
  if (!videoCodec) throw new Error("Nenhum codec de vídeo disponível para exportar neste navegador.");

  const canvas = new OffscreenCanvas(width, height);
  const out = canvas.getContext("2d", { alpha: false })!;
  const direct = scale === 1 && !limits.watermark;
  const stage = direct ? canvas : new OffscreenCanvas(project.width, project.height);
  const ctx = direct ? out : stage.getContext("2d", { alpha: false })!;
  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });

  // Fontes do Brand Kit e, se algum título usa profundidade, o modelo de segmentação.
  await loadProjectFonts(project);
  const depth = personIntervals(project);
  if (depth.length) await ensureSegmenter();

  const audioBuffer = await mixAudio(project, duration);
  const audioCodec = audioBuffer
    ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
      })
    : null;
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const inputs = new Map<string, { input: Input; sink: CanvasSink }>();
  try {
    for (const clip of clips) {
      if (inputs.has(clip.assetId)) continue;
      const blob = mediaBlob(clip.assetId);
      if (!blob) throw new Error("Arquivo de mídia não encontrado. Envie o vídeo novamente.");
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("O arquivo não tem faixa de vídeo.");
      if (!(await track.canDecode()))
        throw new Error("Este navegador não consegue decodificar o codec do vídeo para exportar.");
      inputs.set(clip.assetId, { input, sink: new CanvasSink(track, { poolSize: 2 }) });
    }

    await output.start();
    const audioDone = audioSource && audioBuffer ? audioSource.add(audioBuffer) : Promise.resolve();

    const totalFrames = Math.max(1, Math.round(duration * fps));
    let frame = 0;
    // Último quadro decodificado: se o primeiro quadro de um clip demorar, a emenda repete o anterior em vez de sair preta.
    let last: FrameSource | null = null;
    for (const clip of clips) {
      const end = clip.start + clip.duration;
      const first = frame;
      const sourceTimes: number[] = [];
      for (let i = first; i < totalFrames && i / fps < end; i++)
        sourceTimes.push(clip.sourceStart + Math.max(0, i / fps - clip.start));
      const { sink } = inputs.get(clip.assetId)!;
      for await (const wrapped of sink.canvasesAtTimestamps(sourceTimes)) {
        if (signal?.aborted) throw new DOMException("Exportação cancelada", "AbortError");
        if (wrapped) last = { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height };
        const t = frame / fps;
        const sourceTime = sourceTimes[frame - first] ?? clip.sourceStart;
        renderFrame(ctx, project, t, () => last, {
          // Segmentação só nos quadros dos trechos que pedem; as máscaras vistas no preview vêm do cache.
          getPersonMask: depth.some((r) => t >= r.start && t < r.end)
            ? (c, f) => personMask(maskKey(c.assetId, sourceTime, fps), f.image, f.width, f.height)
            : undefined,
        });
        if (!direct) {
          out.imageSmoothingQuality = "high";
          out.drawImage(stage, 0, 0, width, height);
          if (limits.watermark) drawWatermark(out, width, height);
        }
        await videoSource.add(t, 1 / fps);
        frame++;
        if (frame % 5 === 0) onProgress(frame / totalFrames);
      }
    }

    await audioDone;
    videoSource.close();
    audioSource?.close();
    await output.finalize();
    onProgress(1);
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("A exportação não gerou dados.");
    return { blob: new Blob([buffer], { type: format.mimeType }), extension: format.fileExtension };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const { input } of inputs.values()) input.dispose();
  }
}

/** Monta o áudio final seguindo os cortes da timeline. Retorna null se não houver áudio. */
async function mixAudio(project: Project, duration: number): Promise<AudioBuffer | null> {
  const RATE = 48000;
  const clips = mainClips(project);
  const decoded = new Map<string, AudioBuffer | null>();
  const ac = new AudioContext();
  try {
    for (const clip of clips) {
      if (decoded.has(clip.assetId)) continue;
      const blob = mediaBlob(clip.assetId);
      try {
        decoded.set(clip.assetId, blob ? await ac.decodeAudioData(await blob.arrayBuffer()) : null);
      } catch {
        decoded.set(clip.assetId, null);
      }
    }
  } finally {
    void ac.close();
  }
  if (![...decoded.values()].some(Boolean) && !soundEvents(project).length) return null;

  const off = new OfflineAudioContext(2, Math.ceil(duration * RATE), RATE);
  for (const clip of clips) {
    const buffer = decoded.get(clip.assetId);
    if (!buffer) continue;
    const src = off.createBufferSource();
    src.buffer = buffer;
    const gain = off.createGain();
    // Micro-fade nas bordas de cada corte evita estalos.
    const edge = Math.min(0.008, clip.duration / 4);
    gain.gain.setValueAtTime(0, clip.start);
    gain.gain.linearRampToValueAtTime(clip.volume, clip.start + edge);
    gain.gain.setValueAtTime(clip.volume, clip.start + clip.duration - edge);
    gain.gain.linearRampToValueAtTime(0, clip.start + clip.duration);
    src.connect(gain).connect(off.destination);
    src.start(clip.start, clip.sourceStart, clip.duration);
  }
  // Efeitos sonoros nos mesmos instantes do preview.
  await scheduleSfx(off, project);
  return off.startRendering();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
