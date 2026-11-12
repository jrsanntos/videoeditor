import type { Project, TimeRange } from "./schema";
import { clipEnd, projectDuration, timelineWords } from "./timeline";

/**
 * Serializa o estado da timeline em texto compacto para o agente.
 * Com `selection`, só os metadados daquele trecho são enviados — é o que
 * torna a "intervenção cirúrgica" ~95% mais barata que reprocessar o vídeo.
 */
export function buildAgentContext(project: Project, selection?: TimeRange | null): string {
  const duration = projectDuration(project);
  const inScope = (c: { start: number; duration: number }) =>
    !selection || (clipEnd(c) > selection.start && c.start < selection.end);
  const lines: string[] = [];

  lines.push(
    `Projeto: "${project.name}" — ${project.width}x${project.height} @ ${project.fps}fps — duração ${duration}s`,
  );
  lines.push(
    `Legendas: ${project.captions.enabled ? "ligadas" : "desligadas"} (${JSON.stringify(project.captions.style)})`,
  );
  if (selection)
    lines.push(
      `SELEÇÃO ATIVA: ${selection.start}s–${selection.end}s. O pedido do usuário se refere a este trecho; não altere nada fora dele.`,
    );

  lines.push("", "## Clips");
  for (const track of project.tracks) {
    const clips = track.clips.filter(inScope);
    if (!clips.length) continue;
    lines.push(`Trilha ${track.kind} "${track.name}":`);
    for (const c of clips) {
      const span = `[${c.start}–${clipEnd(c)}]`;
      if (c.type === "media")
        lines.push(`  ${c.id} ${span} vídeo, origem ${c.sourceStart}–${Math.round((c.sourceStart + c.duration) * 1000) / 1000}`);
      else if (c.type === "zoom") lines.push(`  ${c.id} ${span} zoom ${c.scale}x foco(${c.x},${c.y}) ease ${c.ease}`);
      else lines.push(`  ${c.id} ${span} componente ${c.component} ${JSON.stringify(c.params)}`);
    }
  }

  const words = timelineWords(project, selection ?? undefined);
  lines.push("", "## Transcrição (tempo de timeline)");
  if (!words.length) {
    lines.push("(sem transcrição disponível neste trecho)");
    return lines.join("\n");
  }

  if (selection) {
    // Trecho curto: precisão por palavra.
    lines.push("Formato: id | início–fim | palavra");
    for (const w of words) lines.push(`${w.id} | ${w.start}–${w.end} | ${w.text}`);
  } else {
    // Vídeo inteiro: frases curtas com tempo, pausas anotadas.
    lines.push("Formato: [início–fim] texto. Pausas longas aparecem como (pausa Xs).");
    let seg: typeof words = [];
    const flush = () => {
      if (!seg.length) return;
      lines.push(`[${seg[0]!.start}–${seg[seg.length - 1]!.end}] ${seg.map((w) => w.text).join(" ")}`);
      seg = [];
    };
    let prevEnd = 0;
    for (const w of words) {
      const gap = w.start - prevEnd;
      if (seg.length && (gap > 0.35 || seg.length >= 8 || /[.!?]$/.test(seg[seg.length - 1]!.text))) flush();
      if (gap >= 0.5) lines.push(`(pausa ${Math.round(gap * 100) / 100}s)`);
      seg.push(w);
      prevEnd = w.end;
    }
    flush();
  }
  return lines.join("\n");
}
