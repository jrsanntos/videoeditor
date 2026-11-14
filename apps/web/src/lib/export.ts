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
  StreamTarget,
  WebMOutputFormat,
} from "mediabunny";
import { clipEnd, mainClips, projectDuration, sourceTimeAt, toOTIO, type BrollClip, type MediaClip, type Project } from "@videoeditor/core";
import { drawWatermark, personIntervals, renderFrame, type FrameSource } from "@videoeditor/renderer";
import { loadProjectFonts } from "./fonts";
import { mediaBlob } from "./media";
import { ensureSegmenter, maskKey, personMask } from "./segmentation";
import { MIX_CHANNELS, MIX_RATE, prepareAudioMix } from "./export-audio";

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

  // O arquivo final é gravado no disco pelo navegador (armazenamento privado do site) conforme é
  // codificado; sem esse recurso, é montado na memória, como antes (limitado pela RAM da aba).
  const disk = await openDiskFile();
  // MP4/H.264 quando o navegador codifica; senão WebM/VP9. Em disco, o índice do MP4 vai no fim do
  // arquivo (pô-lo no começo exigiria guardar o vídeo inteiro na memória antes de gravar).
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: disk ? false : "in-memory" });
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
  const memory = disk ? null : new BufferTarget();
  const output = new Output({ format, target: disk ? new StreamTarget(disk.writable, { chunked: true }) : memory! });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(videoSource, { frameRate: fps });

  // Fontes do Brand Kit e, se algum título usa profundidade, o modelo de segmentação.
  await loadProjectFonts(project);
  const depth = personIntervals(project);
  if (depth.length) await ensureSegmenter();

  // O áudio é mixado em trechos, lendo do arquivo só o que cada trecho usa (ver export-audio.ts).
  const mix = await prepareAudioMix(project, duration);
  const audioCodec = mix ? await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), { numberOfChannels: MIX_CHANNELS, sampleRate: MIX_RATE }) : null;
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
    // O áudio corre em paralelo com o vídeo: cada trecho mixado vai direto para o codificador, que
    // segura o ritmo quando o áudio se adianta. Uma falha aqui aparece no `await audioDone`.
    const audioDone = (async () => {
      if (!audioSource || !mix) return;
      for await (const segment of mix.segments(signal)) await audioSource.add(segment);
    })();
    // Se o vídeo falhar primeiro, a falha do áudio (cancelamento) não vira erro solto.
    audioDone.catch(() => {});

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
    if (disk) {
      // Arquivo em disco: o Blob devolvido só aponta para ele, sem carregar nada.
      const file = await disk.handle.getFile();
      if (!file.size) throw new Error("A exportação não gerou dados.");
      return { blob: file.slice(0, file.size, format.mimeType), extension: format.fileExtension };
    }
    const buffer = memory?.buffer;
    if (!buffer) throw new Error("A exportação não gerou dados.");
    return { blob: new Blob([buffer], { type: format.mimeType }), extension: format.fileExtension };
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    mix?.dispose();
    for (const { input } of inputs.values()) input.dispose();
  }
}

const EXPORT_PREFIX = "ve-export-";

/**
 * Abre um arquivo no armazenamento privado do site (OPFS) para receber a
 * exportação. Apaga as exportações anteriores que ficaram lá. null quando o
 * navegador não oferece o recurso (a exportação segue na memória).
 */
async function openDiskFile(): Promise<{ handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = root as unknown as { keys(): AsyncIterable<string> };
    for await (const name of dir.keys()) if (name.startsWith(EXPORT_PREFIX)) await root.removeEntry(name).catch(() => {});
    const handle = await root.getFileHandle(`${EXPORT_PREFIX}${Date.now()}`, { create: true });
    return { handle, writable: await handle.createWritable() };
  } catch {
    return null;
  }
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
