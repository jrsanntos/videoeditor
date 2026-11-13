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
import { clipEnd, CUT_FADE, hasSpeed, mainClips, projectDuration, ratePoints, sourceSpan, sourceTimeAt, toOTIO, type BrollClip, type MediaClip, type Project } from "@videoeditor/core";
import { drawWatermark, personIntervals, renderFrame, soundEvents, type FrameSource } from "@videoeditor/renderer";
import { loadProjectFonts } from "./fonts";
import { mediaBlob } from "./media";
import { ensureSegmenter, maskKey, personMask } from "./segmentation";
import { hasMusic, scheduleMusic } from "./music";
import { scheduleSfx } from "./sfx";
import { voiceCompressor, voiceGain } from "./voice";

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
  // Em ordem de tempo; a trilha principal pode ter lacunas (ou nenhum vídeo: composição só com cards e sons).
  const clips = mainClips(project).sort((a, b) => a.start - b.start);
  if (duration <= 0) throw new Error("A timeline está vazia.");

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

    // Mídia de contexto: um leitor por clip, que avança junto com a timeline.
    const brolls = project.tracks.flatMap((t) => t.clips).filter((c): c is BrollClip => c.type === "broll");
    const readers = new Map<string, { frames?: AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number }, void, unknown>; current: FrameSource | null; next: { src: FrameSource; at: number } | null; done: boolean }>();
    const stills = new Map<string, FrameSource>();
    for (const c of brolls) {
      const asset = project.assets[c.assetId];
      const blob = mediaBlob(c.assetId);
      if (!asset || !blob) continue;
      if (asset.kind === "image") {
        if (!stills.has(c.assetId)) {
          const bmp = await createImageBitmap(blob).catch(() => null);
          if (bmp) stills.set(c.assetId, { image: bmp, width: bmp.width, height: bmp.height });
        }
        continue;
      }
      let entry = inputs.get(`broll:${c.assetId}`);
      if (!entry) {
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) {
          input.dispose();
          continue;
        }
        entry = { input, sink: new CanvasSink(track, { poolSize: 3 }) };
        inputs.set(`broll:${c.assetId}`, entry);
      }
      readers.set(c.id, { frames: entry.sink.canvases(c.sourceStart, c.sourceStart + c.duration + 0.1), current: null, next: null, done: false });
    }
    const brollAt = async (t: number) => {
      const out = new Map<string, FrameSource>();
      for (const c of brolls) {
        if (t < c.start || t >= c.start + c.duration) continue;
        const still = stills.get(c.assetId);
        if (still) {
          out.set(c.id, still);
          continue;
        }
        const r = readers.get(c.id);
        if (!r?.frames) continue;
        const want = c.sourceStart + (t - c.start);
        // Avança até o quadro cujo tempo já chegou.
        while (!r.done && (!r.next || r.next.at <= want)) {
          if (r.next) r.current = r.next.src;
          const step = await r.frames.next();
          if (step.done) r.done = true;
          else r.next = { src: { image: step.value.canvas, width: step.value.canvas.width, height: step.value.canvas.height }, at: step.value.timestamp };
        }
        if (r.done && r.next && r.next.at <= want) r.current = r.next.src;
        const shown = r.current ?? r.next?.src;
        if (shown) out.set(c.id, shown);
      }
      return out;
    };

    await output.start();
    const audioDone = audioSource && audioBuffer ? audioSource.add(audioBuffer) : Promise.resolve();

    const totalFrames = Math.max(1, Math.round(duration * fps));
    let frame = 0;
    // Último quadro decodificado: se o primeiro quadro de um clip demorar, a emenda repete o anterior em vez de sair preta.
    let last: FrameSource | null = null;
    /** Compõe e codifica um quadro. `clip` nulo = lacuna (fundo preto com o que estiver por cima). */
    const emit = async (clip: MediaClip | null, sourceTime: number) => {
      if (signal?.aborted) throw new DOMException("Exportação cancelada", "AbortError");
      const t = frame / fps;
      const context = brolls.length ? await brollAt(t) : null;
      renderFrame(ctx, project, t, () => (clip ? last : null), {
        getBrollFrame: context ? (c) => context.get(c.id) ?? null : undefined,
        // Segmentação só nos quadros dos trechos que pedem; as máscaras vistas no preview vêm do cache.
        getPersonMask: clip && depth.some((r) => t >= r.start && t < r.end) ? (c, f) => personMask(maskKey(c.assetId, sourceTime, fps), f.image, f.width, f.height) : undefined,
      });
      if (!direct) {
        out.imageSmoothingQuality = "high";
        out.drawImage(stage, 0, 0, width, height);
        if (limits.watermark) drawWatermark(out, width, height);
      }
      await videoSource.add(t, 1 / fps);
      frame++;
      if (frame % 5 === 0) onProgress(frame / totalFrames);
    };
    for (const clip of clips) {
      // Lacuna antes do clip: quadros sem vídeo.
      while (frame < totalFrames && frame / fps < clip.start - 0.5 / fps) await emit(null, 0);
      const end = clipEnd(clip);
      const first = frame;
      const sourceTimes: number[] = [];
      // Com rampa de velocidade, o tempo de origem de cada quadro segue a curva do clip.
      for (let i = first; i < totalFrames && i / fps < end; i++) sourceTimes.push(sourceTimeAt(clip, i / fps - clip.start));
      if (!sourceTimes.length) continue;
      const { sink } = inputs.get(clip.assetId)!;
      for await (const wrapped of sink.canvasesAtTimestamps(sourceTimes)) {
        if (wrapped) last = { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height };
        await emit(clip, sourceTimes[frame - first] ?? clip.sourceStart);
      }
    }
    // Depois do último clip (ou sem nenhum): o que estiver nas outras trilhas.
    while (frame < totalFrames) await emit(null, 0);

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
  if (![...decoded.values()].some(Boolean) && !soundEvents(project).length && !hasMusic(project)) return null;

  const off = new OfflineAudioContext(2, Math.ceil(duration * RATE), RATE);
  // Barramento da voz: com o acabamento ligado, ganho até o volume padrão das redes e compressão leve.
  const master = project.finish.voice;
  const voiceBus = master ? voiceCompressor(off) : off.destination;
  if (master) voiceBus.connect(off.destination);
  const boost = new Map<string, number>();
  if (master) for (const clip of clips) if (!boost.has(clip.assetId)) boost.set(clip.assetId, await voiceGain(clip.assetId));
  for (const clip of clips) {
    const buffer = decoded.get(clip.assetId);
    if (!buffer) continue;
    const src = off.createBufferSource();
    src.buffer = buffer;
    const gain = off.createGain();
    // Micro-fade de 30 ms (entrada e saída) em TODA fronteira de corte: sem cliques nem pops.
    const edge = Math.min(CUT_FADE, clip.duration / 4);
    const level = clip.volume * (boost.get(clip.assetId) ?? 1);
    gain.gain.setValueAtTime(0, clip.start);
    gain.gain.linearRampToValueAtTime(level, clip.start + edge);
    gain.gain.setValueAtTime(level, clip.start + clip.duration - edge);
    gain.gain.linearRampToValueAtTime(0, clip.start + clip.duration);
    if (hasSpeed(clip)) {
      // Rampa de velocidade: o playbackRate do áudio segue a mesma curva, em rampas lineares
      // (o pitch desliza junto, sem degrau).
      const pts = ratePoints(clip);
      src.playbackRate.setValueAtTime(pts[0]!.rate, clip.start);
      for (const p of pts.slice(1)) src.playbackRate.linearRampToValueAtTime(p.rate, clip.start + p.u * clip.duration);
    }
    src.connect(gain).connect(voiceBus);
    // O terceiro argumento é em segundos de ORIGEM: o trecho que o clip consome.
    src.start(clip.start, clip.sourceStart, sourceSpan(clip));
    src.stop(clip.start + clip.duration + 0.005);
  }
  // Trilha de fundo com auto-ducking de −14 dB sob a voz; fora do compressor da fala.
  await scheduleMusic(off, project, duration);
  // Efeitos sonoros nos mesmos instantes do preview.
  await scheduleSfx(off, project);
  const mixed = await off.startRendering();
  // Teto de segurança: nenhum pico acima de −1 dBFS (sem distorção em nenhum aparelho).
  let peak = 0;
  for (let ch = 0; ch < mixed.numberOfChannels; ch++) {
    const data = mixed.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  }
  const ceiling = 0.89;
  if (peak > ceiling) for (let ch = 0; ch < mixed.numberOfChannels; ch++) {
    const data = mixed.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = (data[i]! * ceiling) / peak;
  }
  return mixed;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Exporta a timeline em OpenTimelineIO (.otio): abre em DaVinci Resolve,
 * Premiere (via adaptador) e outros editores, com clips, lacunas, velocidades
 * e marcadores. A mídia é religada no destino pelo nome do arquivo.
 */
export function exportOTIO(project: Project): Blob {
  return new Blob([JSON.stringify(toOTIO(project), null, 2)], { type: "application/json" });
}
