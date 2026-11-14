import { applyOperations } from "./ops";
import type { ComponentClip, Project } from "./schema";
import { clipEnd, projectDuration } from "./timeline";

const LOWER_THIRDS = new Set(["executive_lower_third", "lower_third"]);
/** Componentes que convivem com a tarja (também ficam na faixa da legenda ou são discretos). */
const COEXISTS = new Set(["executive_lower_third", "lower_third", "tactical_hud_overlay", "step_progress_bar", "callout_pointer"]);
export const LOWER_THIRD_SECONDS = 4.5;

/**
 * Garante a tarja quando a pessoa informou o nome e a tarja está ligada.
 * Quem digitou o nome na landing foi prometido que ele aparece: isso não pode
 * depender de o modelo lembrar. Se a IA já colocou uma tarja, nada muda; se
 * não colocou, entra uma logo depois do gancho (de 2 s em diante), na primeira
 * janela livre de outros cartões.
 */
export function ensureLowerThird(project: Project): { project: Project; log: string[] } {
  const b = project.brand;
  if (!b.showLowerThird || !b.displayName?.trim()) return { project, log: [] };
  const components = project.tracks.flatMap((t) => t.clips).filter((c): c is ComponentClip => c.type === "component");
  if (components.some((c) => LOWER_THIRDS.has(c.component))) return { project, log: [] };
  const total = projectDuration(project);
  if (total < 3) return { project, log: [] };
  const duration = Math.min(LOWER_THIRD_SECONDS, Math.max(2, total - 1));
  const others = components.filter((c) => !COEXISTS.has(c.component));
  const free = (s: number) => others.every((c) => clipEnd(c) <= s + 0.05 || c.start >= s + duration - 0.05);
  let start: number | undefined;
  for (let s = 2; s + duration <= Math.min(total, 15) + 1e-6; s += 0.25) {
    if (free(s)) {
      start = Math.round(s * 100) / 100;
      break;
    }
  }
  // Sem janela livre no começo: entra logo depois do gancho mesmo assim (a tarja fica na faixa de baixo).
  start ??= Math.min(2, Math.max(0, total - duration));
  let next: Project;
  try {
    next = applyOperations(project, [{ op: "add_component", component: "executive_lower_third", start, duration, params: {} }]).project;
  } catch {
    return { project, log: [] };
  }
  return { project: next, log: [`tarja de ${b.displayName.trim()} em ${start}s (o nome foi informado)`] };
}
