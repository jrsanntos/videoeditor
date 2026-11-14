import { mainClipAt, projectDuration, type MediaClip, type Project, type ScreenText } from "@videoeditor/core";
import type { CaptionBox } from "./captions";
import { type EditRegion, type FrameSource, renderFrame } from "./compositor";
import { createProbeContext } from "./probe-context";

/**
 * Sonda de layout: roda o MESMO `renderFrame` do preview num contexto de
 * mentira, que não pinta nada mas acompanha as transformações e mede texto
 * por estimativa. É o que deixa testar, sem navegador, onde cada texto e a
 * legenda caem na tela — e o que o Crítico usa para achar texto sobre o rosto.
 */
export { createProbeContext } from "./probe-context";

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
