"use client";

import type { Project } from "@videoeditor/core";
import { SFX_CATALOG, soundEvents, SYNTH_FALLBACK, synthSfx, type SfxId, type SoundEvent } from "@videoeditor/renderer";

/**
 * Efeitos sonoros no navegador. Os arquivos do catálogo (public/sfx) são
 * baixados e decodificados uma vez; o preview dispara cada evento quando o
 * tempo passa por ele e a exportação agenda todos na mixagem final. Se um
 * arquivo não carregar, entra o timbre sintetizado equivalente, se houver.
 */
const encoded = new Map<SfxId, Promise<ArrayBuffer | null>>();
const decoded = new WeakMap<BaseAudioContext, Map<SfxId, AudioBuffer | null>>();

const fetchSfx = (id: SfxId) => {
  let p = encoded.get(id);
  if (!p) {
    p = fetch(`/sfx/${SFX_CATALOG[id].file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    encoded.set(id, p);
  }
  return p;
};

function synthBuffer(ctx: BaseAudioContext, id: SfxId): AudioBuffer | null {
  const synth = SYNTH_FALLBACK[id];
  if (!synth) return null;
  const samples = synthSfx(synth, ctx.sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

/** Decodifica, para este contexto, os sons que o projeto usa. */
export async function loadSfx(ctx: BaseAudioContext, ids: Iterable<SfxId>): Promise<Map<SfxId, AudioBuffer | null>> {
  let map = decoded.get(ctx);
  if (!map) decoded.set(ctx, (map = new Map()));
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      if (map.has(id)) return;
      const data = await fetchSfx(id);
      // decodeAudioData consome o ArrayBuffer: cada contexto recebe uma cópia.
      const buffer = data ? await ctx.decodeAudioData(data.slice(0)).catch(() => null) : null;
      map.set(id, buffer ?? synthBuffer(ctx, id));
    }),
  );
  return map;
}

function play(ctx: BaseAudioContext, buffer: AudioBuffer, e: SoundEvent, volume: number, when: number, destination: AudioNode) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = e.gain * volume;
  src.connect(gain).connect(destination);
  if (e.duration !== undefined) {
    // Som contínuo (digitação): corta na duração do evento, com uma saída curta para não estalar.
    const end = when + e.duration;
    gain.gain.setValueAtTime(e.gain * volume, Math.max(when, end - 0.05));
    gain.gain.linearRampToValueAtTime(0, end);
    src.start(when, e.skip, e.duration);
  } else src.start(when, e.skip);
}

/** Agenda todos os efeitos do projeto num contexto (usado na exportação). */
export async function scheduleSfx(ctx: BaseAudioContext, project: Project) {
  const events = soundEvents(project);
  if (!events.length) return;
  const buffers = await loadSfx(ctx, events.map((e) => e.sfx));
  for (const e of events) {
    const buffer = buffers.get(e.sfx);
    if (buffer) play(ctx, buffer, e, project.sfx.volume, e.start, ctx.destination);
  }
}

/** Tocador do preview: chame `advance` a cada quadro com o tempo anterior e o atual. */
export function createSfxPlayer() {
  let ctx: AudioContext | null = null;
  let cached: { project: Project; events: SoundEvent[] } | null = null;
  const eventsOf = (project: Project) => {
    if (cached?.project !== project) {
      cached = { project, events: soundEvents(project) };
      // Baixa e decodifica em segundo plano os sons que este projeto usa.
      if (cached.events.length) {
        ctx ??= new AudioContext();
        void loadSfx(ctx, cached.events.map((e) => e.sfx));
      }
    }
    return cached.events;
  };
  return {
    advance(project: Project, from: number, to: number) {
      const events = eventsOf(project);
      // Só em reprodução contínua para a frente; saltos (clique na timeline) não disparam sons.
      if (!ctx || !(to > from) || to - from > 0.25) return;
      const due = events.filter((e) => e.start > from && e.start <= to);
      if (!due.length) return;
      if (ctx.state === "suspended") void ctx.resume();
      const buffers = decoded.get(ctx);
      for (const e of due) {
        const buffer = buffers?.get(e.sfx);
        if (buffer) play(ctx, buffer, e, project.sfx.volume, ctx.currentTime, ctx.destination);
      }
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
