import type { Project, TimeRange } from "./schema";
import { clipEnd, projectDuration, timelineWords, type TimelineWord } from "./timeline";

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
    lines.push(...wordLines(words));
    return lines.join("\n");
  }

  // Vídeo inteiro: frases curtas com tempo, pausas anotadas.
  lines.push(
    "Formato: [início–fim] texto. Pausas longas aparecem como (pausa Xs).",
    "Os tempos de frase são só um agrupamento: existe tempo por palavra. Para cortar com precisão, peça os tempos com a ferramenta read_words.",
  );
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

  // Repetições/retomadas detectadas: já com tempo por palavra, para cortar sem comer sílabas.
  const reps = findRepetitions(words);
  if (reps.length) {
    lines.push(
      "",
      "## Possíveis repetições (tempo por palavra)",
      "Cada uma traz o corte exato que remove a primeira ocorrência (do início dela ao início da segunda). Use esse intervalo como está em remove_ranges; não recalcule. Se a repetição for ênfase intencional, mantenha.",
    );
    for (const r of reps) {
      const cut = repetitionCut(words, r);
      lines.push(`"${r.phrase}" repetido — corte: {"start": ${cut.start}, "end": ${cut.end}}`);
      const from = Math.max(0, r.firstIndex - 1);
      const to = Math.min(words.length, r.secondIndex + r.length + 1);
      lines.push(...wordLines(words.slice(from, to)).slice(1));
    }
  }
  return lines.join("\n");
}

/** Linhas "id | início–fim | palavra", com cabeçalho de formato. */
export function wordLines(words: TimelineWord[]): string[] {
  return ["Formato: id | início–fim | palavra", ...words.map((w) => `${w.id} | ${w.start}–${w.end} | ${w.text}`)];
}

/** Intervalo que remove a primeira ocorrência de uma repetição, mantendo a segunda inteira. */
export function repetitionCut(words: TimelineWord[], r: Repetition): TimeRange {
  return { start: words[r.firstIndex]!.start, end: words[r.secondIndex]!.start };
}

export type Repetition = {
  phrase: string;
  /** Índices em `words` do início da 1ª e da 2ª ocorrência. */
  firstIndex: number;
  secondIndex: number;
  length: number;
};

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Detecta retomadas: a mesma sequência de 1 a 4 palavras dita duas vezes em
 * seguida ("o segredo, o segredo"). Uma palavra sozinha só conta com 4+
 * letras, para não marcar artigos e interjeições ("é é", "o o").
 */
export function findRepetitions(words: TimelineWord[], maxLen = 4): Repetition[] {
  const n = words.map((w) => norm(w.text));
  const out: Repetition[] = [];
  let i = 0;
  while (i < n.length) {
    let found: Repetition | null = null;
    for (let len = maxLen; len >= 1; len--) {
      if (i + 2 * len > n.length) continue;
      const a = n.slice(i, i + len);
      const b = n.slice(i + len, i + 2 * len);
      if (a.some((x) => !x) || a.join(" ") !== b.join(" ")) continue;
      if (len === 1 && a[0]!.length < 4) continue;
      // retomada é imediata: pausa longa entre as ocorrências indica outra coisa
      if (words[i + len]!.start - words[i + len - 1]!.end > 1.5) continue;
      found = {
        phrase: words.slice(i, i + len).map((w) => w.text.replace(/[.,!?;:]+$/, "")).join(" "),
        firstIndex: i,
        secondIndex: i + len,
        length: len,
      };
      break;
    }
    if (found) {
      out.push(found);
      i = found.secondIndex + found.length;
    } else i++;
  }
  return out;
}
