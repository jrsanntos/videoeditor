import { mainClipAt, projectDuration, type MediaClip, type Project, type ScreenText } from "@videoeditor/core";
import type { CaptionBox } from "./captions";
import { type EditRegion, type FrameSource, renderFrame } from "./compositor";
import type { Ctx2D } from "./draw";

/**
 * Sonda de layout: roda o MESMO `renderFrame` do preview num contexto de
 * mentira, que não pinta nada mas acompanha as transformações e mede texto
 * por estimativa. É o que deixa testar, sem navegador, onde cada texto e a
 * legenda caem na tela — e o que o Crítico usa para achar texto sobre o rosto.
 */
type M = [number, number, number, number, number, number];

export function createProbeContext(width: number, height: number): Ctx2D {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: { m: M; font: string; alpha: number }[] = [];
  const state: Record<string, unknown> = { font: "10px sans-serif", globalAlpha: 1, filter: "none", canvas: { width, height } };
  const mul = (a: M, b: M): M => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const gradient = { addColorStop() {} };
  const methods: Record<string, (...args: number[]) => unknown> = {
    save: () => void stack.push({ m: [...m] as M, font: state.font as string, alpha: state.globalAlpha as number }),
    restore: () => {
      const s = stack.pop();
      if (s) {
        m = s.m;
        state.font = s.font;
        state.globalAlpha = s.alpha;
      }
    },
    translate: (x, y) => void (m = mul(m, [1, 0, 0, 1, x!, y!])),
    scale: (x, y) => void (m = mul(m, [x!, 0, 0, y!, 0, 0])),
    rotate: (a) => void (m = mul(m, [Math.cos(a!), Math.sin(a!), -Math.sin(a!), Math.cos(a!), 0, 0])),
    setTransform: (a, b, c, d, e, f) => void (m = [a ?? 1, b ?? 0, c ?? 0, d ?? 1, e ?? 0, f ?? 0]),
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    measureText: (text) => {
      // Largura média de um caractere em fonte sem serifa de peso forte: ~0,56 do corpo.
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(state.font as string)?.[1] ?? 10);
      return { width: String(text).length * px * 0.56 };
    },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(state, {
    get: (target, key: string) => (key in methods ? methods[key] : key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as Ctx2D;
}

export type ProbeResult = { regions: EditRegion[]; caption: CaptionBox | null };

/** O que seria desenhado em `t`: textos dos componentes e a legenda, em pixels do quadro. */
export function probeFrame(project: Project, t: number, opts: { hasMask?: boolean } = {}): ProbeResult {
  const ctx = createProbeContext(project.width, project.height);
  const out: ProbeResult = { regions: [], caption: null };
  const fake = (clip: MediaClip): FrameSource => {
    const a = project.assets[clip.assetId];
    return { image: {} as CanvasImageSource, width: a?.width ?? project.width, height: a?.height ?? project.height };
  };
  renderFrame(ctx, project, t, fake, {
    onRegion: (r) => out.regions.push(r),
    onCaption: (b) => (out.caption = b),
    getBrollFrame: () => ({ image: {} as CanvasImageSource, width: project.width, height: project.height }),
    // Sem canvas de verdade não há recorte para montar: a sonda só diz ao layout se ele existiria.
    assumePerson: opts.hasMask === true,
  });
  return out;
}

/**
 * Todos os textos de componentes na tela ao longo do vídeo (um instante por
 * componente, depois da animação de entrada), em frações do quadro: a entrada
 * do Crítico para "texto na frente do rosto".
 */
export function screenTexts(project: Project): ScreenText[] {
  const out: ScreenText[] = [];
  const duration = projectDuration(project);
  for (const track of project.tracks)
    for (const c of track.clips) {
      if (c.type !== "component") continue;
      const t = Math.min(duration - 0.01, c.start + Math.min(c.duration * 0.6, Math.max(0.8, c.duration - 0.6)));
      if (!mainClipAt(project, t)) continue;
      for (const r of probeFrame(project, t).regions) if (r.clipId === c.id) out.push({ clipId: c.id, t, box: { x: r.x / project.width, y: r.y / project.height, w: r.w / project.width, h: r.h / project.height } });
    }
  return out;
}
