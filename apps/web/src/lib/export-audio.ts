"use client";

import { clipEnd, concatFloat32, createResampler, cutFadeGain, CUT_FADE, hasSpeed, mainClips, rateAt, ratePoints, sourceTimeAt, type MediaClip, type Project } from "@videoeditor/core";
import { soundEvents } from "@videoeditor/renderer";
import { mediaBlob } from "./media";
import { hasMusic, scheduleMusic } from "./music";
import { scheduleSfx } from "./sfx";
import { voiceCompressor, voiceGain } from "./voice";

/**
 * Áudio da exportação, renderizado em trechos.
 *
 * Antes a mixagem decodificava o arquivo inteiro (arrayBuffer + decodeAudioData)
 * e renderizava o vídeo todo de uma vez: um vídeo de meia hora pedia vários GB
 * de memória e a aba caía. Agora cada trecho de SEGMENT_SEC segundos lê do
 * arquivo só o áudio que usa, é mixado sozinho e segue direto para o
 * codificador. A memória usada não cresce com a duração do vídeo.
 */
export const MIX_RATE = 48000;
export const MIX_CHANNELS = 2;
const SEGMENT_SEC = 30;
/**
 * Cada trecho começa a ser renderizado um pouco antes e essa sobra é descartada:
 * o compressor da voz chega ao começo do trecho já no regime em que estaria
 * numa renderização contínua, e a emenda entre trechos não se ouve.
 */
const PREROLL_SEC = 1;
/** Folga lida em volta de cada trecho de origem, para o filtro de reamostragem não ver uma borda. */
const SOURCE_MARGIN = 0.05;

/** Áudio de um arquivo, lido por trechos. `start` é o instante do arquivo em que o buffer devolvido começa. */
type Source = { range(start: number, end: number): Promise<{ buffer: AudioBuffer; start: number } | null>; dispose(): void };

async function openSource(blob: Blob): Promise<Source | null> {
  try {
    const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) {
      input.dispose();
      return null;
    }
    if (await track.canDecode()) {
      const sink = new AudioBufferSink(track);
      return {
        async range(start, end) {
          const from = Math.max(0, start - SOURCE_MARGIN);
          const to = end + SOURCE_MARGIN;
          let rate = 0;
          let planes: Float32Array[] = [];
          for await (const wb of sink.buffers(from, to)) {
            const b = wb.buffer;
            if (!rate) {
              rate = b.sampleRate;
              const n = Math.max(1, Math.ceil((to - from) * rate));
              planes = Array.from({ length: MIX_CHANNELS }, () => new Float32Array(n));
            }
            if (b.sampleRate !== rate) continue;
            // Cada pedaço decodificado entra na posição que o tempo dele indica.
            const at = Math.round((wb.timestamp - from) * rate);
            const skip = Math.max(0, -at);
            const count = Math.min(b.length - skip, planes[0]!.length - Math.max(0, at));
            if (count <= 0) continue;
            for (let c = 0; c < MIX_CHANNELS; c++) {
              // Mono vai igual para os dois canais; acima de estéreo ficam os dois primeiros.
              const data = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
              planes[c]!.set(data.subarray(skip, skip + count), Math.max(0, at));
            }
          }
          if (!rate) return null;
          const out = planes.map((p) => {
            if (rate === MIX_RATE) return p;
            // Reamostragem com filtro: tocar numa taxa diferente usaria interpolação linear (chiado na voz).
            const r = createResampler(rate, MIX_RATE);
            return concatFloat32([r.push(p), r.flush()]);
          });
          const buffer = new AudioBuffer({ length: Math.max(1, out[0]!.length), numberOfChannels: MIX_CHANNELS, sampleRate: MIX_RATE });
          out.forEach((p, c) => buffer.getChannelData(c).set(p.subarray(0, buffer.length)));
          return { buffer, start: from };
        },
        dispose: () => input.dispose(),
      };
    }
    input.dispose();
  } catch (e) {
    console.warn("leitura do áudio em streaming indisponível para este arquivo; usando a memória", e);
  }
  // Codec que o leitor em streaming não decodifica: o caminho antigo, com o arquivo inteiro na memória.
  try {
    const whole = await new OfflineAudioContext(MIX_CHANNELS, 1, MIX_RATE).decodeAudioData(await blob.arrayBuffer());
    return { range: async () => ({ buffer: whole, start: 0 }), dispose: () => {} };
  } catch {
    return null;
  }
}

/** Nenhum pico acima de −1 dBFS (sem distorção em nenhum aparelho). */
const CEILING = 0.89;

export type AudioMix = {
  /** Trechos consecutivos do áudio final, do começo ao fim. */
  segments(signal?: AbortSignal): AsyncGenerator<AudioBuffer, void, unknown>;
  dispose(): void;
};

/** Prepara a mixagem. null = o vídeo final não tem áudio nenhum. */
export async function prepareAudioMix(project: Project, duration: number, opts: { segmentSec?: number } = {}): Promise<AudioMix | null> {
  const clips = mainClips(project).sort((a, b) => a.start - b.start);
  const sources = new Map<string, Source | null>();
  for (const clip of clips) {
    if (sources.has(clip.assetId)) continue;
    const blob = mediaBlob(clip.assetId);
    sources.set(clip.assetId, blob ? await openSource(blob) : null);
  }
  const dispose = () => {
    for (const s of sources.values()) s?.dispose();
  };
  if (![...sources.values()].some(Boolean) && !soundEvents(project).length && !hasMusic(project)) {
    dispose();
    return null;
  }
  const master = project.finish.voice;
  const boost = new Map<string, number>();
  if (master) for (const clip of clips) if (!boost.has(clip.assetId)) boost.set(clip.assetId, await voiceGain(clip.assetId));

  const total = Math.ceil(duration * MIX_RATE);
  const segment = Math.max(1, Math.round((opts.segmentSec ?? SEGMENT_SEC) * MIX_RATE));
  const preroll = Math.round(PREROLL_SEC * MIX_RATE);

  /** Agenda no contexto a parte de `clip` que cai entre `base` e `end` (tempos de timeline). */
  const scheduleClip = async (ctx: OfflineAudioContext, bus: AudioNode, clip: MediaClip, base: number, end: number) => {
    const source = sources.get(clip.assetId);
    const a = Math.max(clip.start, base);
    const b = Math.min(clipEnd(clip), end);
    if (!source || b - a <= 0) return;
    const localA = a - clip.start;
    const localB = b - clip.start;
    const srcA = sourceTimeAt(clip, localA);
    const srcB = sourceTimeAt(clip, localB);
    const got = await source.range(srcA, srcB);
    if (!got) return;
    const src = ctx.createBufferSource();
    src.buffer = got.buffer;
    const gain = ctx.createGain();
    // Micro-fade de 30 ms na entrada e na saída de TODO corte (sem cliques), mesmo quando o clip atravessa dois trechos.
    const level = clip.volume * (boost.get(clip.assetId) ?? 1);
    const edge = Math.min(CUT_FADE, clip.duration / 4);
    const g = (local: number) => level * cutFadeGain(local, clip.duration);
    gain.gain.setValueAtTime(g(localA), a - base);
    for (const knot of [edge, clip.duration - edge]) if (knot > localA && knot < localB) gain.gain.linearRampToValueAtTime(g(knot), clip.start + knot - base);
    gain.gain.linearRampToValueAtTime(g(localB), b - base);
    if (hasSpeed(clip)) {
      // Rampa de velocidade: o playbackRate segue a mesma curva do vídeo, em rampas lineares (o pitch desliza junto).
      src.playbackRate.setValueAtTime(rateAt(clip, localA), a - base);
      for (const p of ratePoints(clip)) {
        const at = p.u * clip.duration;
        if (at > localA && at < localB) src.playbackRate.linearRampToValueAtTime(p.rate, clip.start + at - base);
      }
      src.playbackRate.linearRampToValueAtTime(rateAt(clip, localB), b - base);
    }
    src.connect(gain).connect(bus);
    // O terceiro argumento é em segundos de ORIGEM: o pedaço do arquivo que este trecho consome.
    src.start(a - base, Math.max(0, srcA - got.start), srcB - srcA);
    src.stop(b - base + 0.005);
  };

  /** Renderiza um trecho por vez, do começo ao fim, sem o teto de volume. */
  async function* render(signal?: AbortSignal): AsyncGenerator<AudioBuffer, void, unknown> {
      for (let first = 0; first < total; first += segment) {
        if (signal?.aborted) throw new DOMException("Exportação cancelada", "AbortError");
        const last = Math.min(total, first + segment);
        const lead = Math.min(first, preroll);
        const base = (first - lead) / MIX_RATE;
        const end = last / MIX_RATE;
        const ctx = new OfflineAudioContext(MIX_CHANNELS, last - first + lead, MIX_RATE);
        // Barramento da voz: com o acabamento ligado, ganho até o volume padrão das redes e compressão leve.
        const bus = master ? voiceCompressor(ctx) : ctx.destination;
        if (master) bus.connect(ctx.destination);
        for (const clip of clips) await scheduleClip(ctx, bus, clip, base, end);
        // Trilha de fundo (com ducking sob a voz) e efeitos sonoros, fora do compressor da fala.
        await scheduleMusic(ctx, project, duration, { base, end });
        await scheduleSfx(ctx, project, { base, end });
        const rendered = await ctx.startRendering();
        const out = new AudioBuffer({ length: last - first, numberOfChannels: MIX_CHANNELS, sampleRate: MIX_RATE });
        for (let c = 0; c < MIX_CHANNELS; c++) out.getChannelData(c).set(rendered.getChannelData(c).subarray(lead, lead + out.length));
        yield out;
      }
  }

  return {
    async *segments(signal) {
      // Primeira passada: só mede o pico da mixagem inteira. Se ele passa do teto, o vídeo TODO desce
      // na mesma proporção (o equilíbrio entre voz, trilha e efeitos não muda), como numa masterização.
      // Custa decodificar o áudio duas vezes; em troca, nenhum trecho fica na memória.
      let peak = 0;
      for await (const buffer of render(signal))
        for (let c = 0; c < MIX_CHANNELS; c++) {
          const data = buffer.getChannelData(c);
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
        }
      const scale = peak > CEILING ? CEILING / peak : 1;
      for await (const buffer of render(signal)) {
        if (scale !== 1)
          for (let c = 0; c < MIX_CHANNELS; c++) {
            const data = buffer.getChannelData(c);
            for (let i = 0; i < data.length; i++) data[i] = data[i]! * scale;
          }
        yield buffer;
      }
    },
    dispose,
  };
}
