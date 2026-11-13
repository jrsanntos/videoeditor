"use client";

import { projectDuration, type Project } from "@videoeditor/core";
import { duckingEnvelope, gainAt, synthMusic, type GainPoint } from "@videoeditor/renderer";
import { mediaBlob } from "./media";

/**
 * Trilha de fundo no navegador: o loop da casa (sintetizado) ou um áudio do
 * usuário, com auto-ducking de −14 dB sob a voz. O preview e a exportação
 * usam o mesmo envelope, calculado do estado da timeline.
 */
const FADE_IN = 0.5;
const FADE_OUT = 1.2;
const loops = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer | null>>>();

const musicKey = (project: Project) => (project.music.assetId ? `asset:${project.music.assetId}` : project.music.mood);
export const hasMusic = (project: Project) => project.music.mood !== "none" || !!project.music.assetId;

/** Buffer da trilha do projeto para este contexto (decodificado ou sintetizado uma vez). */
export function musicBuffer(ctx: BaseAudioContext, project: Project): Promise<AudioBuffer | null> {
  if (!hasMusic(project)) return Promise.resolve(null);
  let map = loops.get(ctx);
  if (!map) loops.set(ctx, (map = new Map()));
  const key = musicKey(project);
  let p = map.get(key);
  if (!p) {
    p = (async () => {
      if (project.music.assetId) {
        const blob = mediaBlob(project.music.assetId);
        return blob ? ctx.decodeAudioData(await blob.arrayBuffer()).catch(() => null) : null;
      }
      if (project.music.mood === "none") return null;
      const samples = synthMusic(project.music.mood, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    })();
    map.set(key, p);
  }
  return p;
}

/** Ganho final da trilha em `t`: volume × ducking × fades de entrada e de saída do vídeo. */
export function musicGainAt(project: Project, env: GainPoint[], t: number, duration: number): number {
  const edge = Math.min(1, t / FADE_IN, Math.max(0, (duration - t) / FADE_OUT));
  return project.music.volume * gainAt(env, t) * Math.max(0, edge);
}

/** Agenda a trilha inteira num contexto offline (exportação), com o ducking como automação de ganho. */
export async function scheduleMusic(ctx: OfflineAudioContext, project: Project, duration: number) {
  const buffer = await musicBuffer(ctx, project);
  if (!buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const gain = ctx.createGain();
  const env = duckingEnvelope(project);
  // Pontos do envelope + bordas dos fades: rampas lineares entre eles.
  const times = [...new Set([0, FADE_IN, ...env.map((p) => p.t), Math.max(0, duration - FADE_OUT), duration])].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);
  gain.gain.setValueAtTime(musicGainAt(project, env, 0, duration), 0);
  for (const t of times.slice(1)) gain.gain.linearRampToValueAtTime(musicGainAt(project, env, t, duration), t);
  src.connect(gain).connect(ctx.destination);
  src.start(0);
  src.stop(duration);
}

/** Tocador do preview: chame `sync` a cada quadro. */
export function createMusicPlayer() {
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let playingKey = "";
  let expected = -1;
  let cached: { project: Project; env: GainPoint[]; duration: number } | null = null;
  const stop = () => {
    try {
      source?.stop();
    } catch {
      // já parado
    }
    source = null;
    playingKey = "";
  };
  return {
    sync(project: Project, t: number, playing: boolean) {
      if (!hasMusic(project) || !playing) {
        if (source) stop();
        return;
      }
      if (cached?.project !== project) cached = { project, env: duckingEnvelope(project), duration: projectDuration(project) };
      ctx ??= new AudioContext();
      if (!gain) {
        gain = ctx.createGain();
        gain.connect(ctx.destination);
      }
      if (ctx.state === "suspended") void ctx.resume();
      const key = musicKey(project);
      // Recomeça quando a trilha muda ou o cursor salta (clique na timeline).
      if (source && (playingKey !== key || Math.abs(t - expected) > 0.35)) stop();
      const level = musicGainAt(project, cached.env, t, cached.duration);
      if (!source) {
        const audio = ctx;
        const out = gain;
        playingKey = key;
        void musicBuffer(audio, project).then((buffer) => {
          if (!buffer || source || playingKey !== key) return;
          const src = audio.createBufferSource();
          src.buffer = buffer;
          src.loop = true;
          src.connect(out);
          out.gain.value = level;
          src.start(0, Math.max(0, expected) % buffer.duration);
          source = src;
        });
      } else gain.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
      expected = t;
    },
    close() {
      stop();
      void ctx?.close();
      ctx = null;
      gain = null;
    },
  };
}
