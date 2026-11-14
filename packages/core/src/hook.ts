import { applyOperations } from "./ops";
import type { PacingProfile } from "./pacing";
import type { Project } from "./schema";
import { projectDuration, timelineWords } from "./timeline";

/** O gancho é o que acontece na tela até este instante. */
export const HOOK_WINDOW = 2;

/**
 * Garante o gancho visual. Todos os modelos prometem que o vídeo começa com
 * movimento (título, punch-in ou avanço de câmera nos primeiros segundos), e
 * isso não pode depender de o modelo lembrar: em close-up o título de gancho é
 * recusado por falta de espaço e, se a IA não puser nada no lugar, o vídeo
 * abre parado. Se já existe zoom, card, mídia ou impacto na janela do gancho,
 * nada muda. Senão entra um movimento de câmera na primeira palavra: punch-in
 * nos modelos de ritmo, avanço lento nos sóbrios.
 */
export function ensureHook(project: Project, profile: PacingProfile): { project: Project; log: string[] } {
  if (!profile.edges || projectDuration(project) < 5) return { project, log: [] };
  const words = timelineWords(project);
  if (!words.length) return { project, log: [] };
  const clips = project.tracks.flatMap((t) => t.clips);
  const visual = clips.some((c) => (c.type === "zoom" || c.type === "component" || c.type === "broll" || c.type === "impact") && c.start < HOOK_WINDOW);
  if (visual) return { project, log: [] };
  // Se a IA deixou uma subida de tensão (riser) apontando para o começo, o movimento entra no pico dela.
  const riser = clips.find((c) => c.type === "sfx" && c.sfx === "riser" && c.start < HOOK_WINDOW + 1);
  const start = Math.max(0, Math.min(riser ? riser.start : words[0]!.start, HOOK_WINDOW - 0.5));
  const sober = profile.maxPunchStreak <= 1;
  try {
    const next = applyOperations(project, [
      sober
        ? { op: "add_zoom", start, duration: 3.5, scale: Math.max(1.12, profile.minZoomScale), mode: "creep", easing: "ease_out" }
        : { op: "add_zoom", start, duration: 1.4, scale: Math.max(1.2, profile.minZoomScale), ease: 0.12, easing: "spring" },
    ]).project;
    return { project: next, log: [`gancho: ${sober ? "avanço lento" : "punch-in"} de câmera em ${start}s (o começo estava parado)`] };
  } catch {
    return { project, log: [] };
  }
}
