"use client";

import type { Project } from "@videoeditor/core";
import { soundEvents, synthSfx, type SfxId, type SoundEvent } from "@videoeditor/renderer";

/**
 * Efeitos sonoros no navegador. As amostras são sintetizadas uma vez por
 * contexto de áudio; o preview dispara cada evento quando o tempo passa por
 * ele e a exportação agenda todos na mixagem final.
 */
const IDS: SfxId[] = ["whoosh", "tick", "pop", "riser"];
const buffers = new WeakMap<BaseAudioContext, Map<SfxId, AudioBuffer>>();

export function sfxBuffer(ctx: BaseAudioContext, id: SfxId): AudioBuffer {
  let map = buffers.get(ctx);
  if (!map) buffers.set(ctx, (map = new Map()));
  let buffer = map.get(id);
  if (!buffer) {
    const samples = synthSfx(id, ctx.sampleRate);
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    map.set(id, buffer);
  }
  return buffer;
}

/** Agenda todos os efeitos do projeto num contexto (usado na exportação). */
export function scheduleSfx(ctx: BaseAudioContext, project: Project, destination: AudioNode = ctx.destination) {
  const gain = ctx.createGain();
  gain.gain.value = project.sfx.volume;
  gain.connect(destination);
  for (const e of soundEvents(project)) {
    const src = ctx.createBufferSource();
    src.buffer = sfxBuffer(ctx, e.sfx);
    src.connect(gain);
    src.start(e.t);
  }
}

/** Tocador do preview: chame `advance` a cada quadro com o tempo anterior e o atual. */
export function createSfxPlayer() {
  let ctx: AudioContext | null = null;
  let cached: { project: Project; events: SoundEvent[] } | null = null;
  return {
    advance(project: Project, from: number, to: number) {
      // Só em reprodução contínua para a frente; saltos (clique na timeline) não disparam sons.
      if (!(to > from) || to - from > 0.25) return;
      if (cached?.project !== project) cached = { project, events: soundEvents(project) };
      const due = cached.events.filter((e) => e.t > from && e.t <= to);
      if (!due.length) return;
      ctx ??= new AudioContext();
      if (ctx.state === "suspended") void ctx.resume();
      for (const e of due) {
        const src = ctx.createBufferSource();
        src.buffer = sfxBuffer(ctx, e.sfx);
        const gain = ctx.createGain();
        gain.gain.value = project.sfx.volume;
        src.connect(gain).connect(ctx.destination);
        src.start();
      }
    },
    /** Sintetiza as amostras antes do primeiro uso, para o primeiro som não atrasar. */
    warm() {
      ctx ??= new AudioContext();
      for (const id of IDS) sfxBuffer(ctx, id);
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
