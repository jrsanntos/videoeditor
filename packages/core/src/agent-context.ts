import type { Project, TimeRange } from "./schema";
import { findRetakes } from "./retakes";
import { clipEnd, projectDuration, timelineWords, type TimelineWord } from "./timeline";

/**
 * Serializa o estado da timeline em texto compacto para o agente.
 *
 * Tudo é referenciado por id de palavra e por tempo do vídeo BRUTO — valores
 * que não mudam quando a timeline é cortada. O agente nunca recebe nem devolve
 * tempo de timeline, então não há o que recalcular depois de um corte.
 *
 * Com `selection`, só os metadados daquele trecho são enviados — é o que
 * torna a "intervenção cirúrgica" ~95% mais barata que reprocessar o vídeo.
 */
export function buildAgentContext(project: Project, selection?: TimeRange | null): string {
  const all = timelineWords(project);
  const words = selection ? all.filter((w) => w.end > selection.start && w.start < selection.end) : all;
  const source = sourceIndex(project);
  const inScope = (c: { start: number; duration: number }) =>
    !selection || (clipEnd(c) > selection.start && c.start < selection.end);
  const lines: string[] = [];

  lines.push(
    `Projeto: "${project.name}" — ${project.width}x${project.height} (${project.height > project.width ? "vertical" : "horizontal"}) @ ${project.fps}fps — duração atual ${projectDuration(project)}s`,
  );
  const b = project.brand;
  lines.push(
    `Brand Kit: destaque ${b.primaryColor}, apoio ${b.secondaryColor}, fundo ${b.backgroundColor}, texto ${b.textColor}` +
      (b.displayName ? ` — apresentador: ${b.displayName}${b.credential ? ` • ${b.credential}` : ""}` : " — apresentador não informado"),
  );
  lines.push(`Legendas: ${project.captions.enabled ? "ligadas" : "desligadas"} (${JSON.stringify(project.captions.style)})`);
  if (selection)
    lines.push(
      words.length
        ? `SELEÇÃO ATIVA: palavras ${words[0]!.id}–${words[words.length - 1]!.id}. O pedido do usuário se refere a este trecho; não altere nada fora dele.`
        : "SELEÇÃO ATIVA num trecho sem fala. O pedido do usuário se refere só a esse trecho.",
    );

  // Zooms e componentes, localizados pelas palavras que cobrem.
  const overlays: string[] = [];
  for (const track of project.tracks) {
    for (const c of track.clips) {
      if (c.type === "media" || !inScope(c)) continue;
      const covered = all.filter((w) => w.start < clipEnd(c) && w.end > c.start);
      const where = covered.length ? `${covered[0]!.id}–${covered[covered.length - 1]!.id}` : "sem fala";
      overlays.push(
        c.type === "zoom"
          ? `  ${c.id} [${where}] ${c.duration}s zoom ${c.scale}x foco(${c.x},${c.y}) ease ${c.ease}`
          : `  ${c.id} [${where}] ${c.duration}s componente ${c.component} ${JSON.stringify(c.params)}`,
      );
    }
  }
  if (overlays.length) lines.push("", "## Zooms e componentes já na timeline", ...overlays);

  lines.push("", "## Transcrição");
  if (!words.length) {
    lines.push("(sem transcrição disponível neste trecho)");
    return lines.join("\n");
  }

  if (selection) {
    // Trecho curto: precisão por palavra.
    lines.push(...wordLines(project, words));
  } else {
    // Vídeo inteiro: frases curtas; os ids dentro de uma frase são consecutivos.
    lines.push(
      "Formato: [primeira palavra–última palavra | início–fim no vídeo bruto, em s] texto.",
      "Dentro de uma frase os ids são consecutivos (a 3ª palavra de [w10–w17] é w12). Na dúvida, confira com read_words. Pausas longas aparecem como (pausa Xs).",
    );
    let seg: TimelineWord[] = [];
    const flush = () => {
      if (!seg.length) return;
      const a = seg[0]!;
      const z = seg[seg.length - 1]!;
      lines.push(`[${a.id}–${z.id} | ${source.get(a)!.start}–${source.get(z)!.end}] ${seg.map((w) => w.text).join(" ")}`);
      seg = [];
    };
    let prev: TimelineWord | null = null;
    for (const w of words) {
      const gap = prev ? w.start - prev.end : w.start;
      // Quebra também onde houve corte, para os ids de uma frase serem sempre consecutivos.
      const contiguous = prev && prev.assetId === w.assetId && source.get(w)!.index === source.get(prev)!.index + 1;
      if (seg.length && (gap > 0.35 || seg.length >= 8 || !contiguous || /[.!?]$/.test(prev!.text))) flush();
      if (gap >= 0.5) lines.push(`(pausa ${Math.round(gap * 100) / 100}s)`);
      seg.push(w);
      prev = w;
    }
    flush();
  }

  const takes = findRetakes(words);
  if (takes.length) {
    lines.push(
      "",
      "## Takes ruins detectados",
      "Erros de gravação prováveis, já com o corte exato (mantém o último take). confiança alta: corte. confiança media: leia o trecho e decida — repetição também pode ser ênfase intencional.",
    );
    for (const r of takes)
      lines.push(`${r.confidence} | ${r.kind} | cortar {"from":"${r.from}","to":"${r.to}"} "${r.cutText}" → fica "${r.keepText}"`);
  }
  return lines.join("\n");
}

type SourceWord = { index: number; start: number; end: number };

/** Posição e tempo de ORIGEM de cada palavra da timeline. */
function sourceIndex(project: Project) {
  const byAsset = new Map<string, Map<string, SourceWord>>();
  for (const asset of Object.values(project.assets)) {
    const m = new Map<string, SourceWord>();
    asset.transcript?.words.forEach((w, index) => m.set(w.id, { index, start: w.start, end: w.end }));
    byAsset.set(asset.id, m);
  }
  return { get: (w: TimelineWord) => byAsset.get(w.assetId)?.get(w.id) };
}

/** Linhas "id | início–fim (vídeo bruto) | palavra", com cabeçalho de formato. */
export function wordLines(project: Project, words: TimelineWord[]): string[] {
  const source = sourceIndex(project);
  return [
    "Formato: id | início–fim no vídeo bruto (s) | palavra",
    ...words.map((w) => {
      const s = source.get(w);
      return `${w.id} | ${s?.start ?? w.start}–${s?.end ?? w.end} | ${w.text}`;
    }),
  ];
}

/** Palavras da timeline entre dois ids (inclusive), para a ferramenta read_words. */
export function wordsBetween(project: Project, fromId: string, toId: string, max: number): TimelineWord[] {
  const words = timelineWords(project);
  const a = words.findIndex((w) => w.id === fromId);
  if (a < 0) throw new Error(`palavra ${fromId} não está na timeline (não existe ou já foi cortada)`);
  const b = words.findIndex((w) => w.id === toId);
  if (b < 0) throw new Error(`palavra ${toId} não está na timeline (não existe ou já foi cortada)`);
  return words.slice(Math.min(a, b), Math.min(Math.max(a, b) + 1, Math.min(a, b) + max));
}
