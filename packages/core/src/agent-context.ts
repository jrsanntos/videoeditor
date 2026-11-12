import type { Project, TimeRange } from "./schema";
import { findRetakes } from "./retakes";
import { clipEnd, contextAssets, projectDuration, subjectAt, timelineWords, type TimelineWord } from "./timeline";

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
  lines.push(
    !b.showLowerThird
      ? "Tarja de nome/cargo: DESLIGADA pelo usuário. Não use executive_lower_third nem cite isso como pendência."
      : b.displayName
        ? "Tarja de nome/cargo: disponível (executive_lower_third sem params)."
        : "Tarja de nome/cargo: indisponível (sem nome no Brand Kit). Não use e não trate como pendência: abra o vídeo com outro recurso.",
  );
  lines.push(...framingLines(project));
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
          : c.type === "broll"
            ? `  ${c.id} [${where}] ${c.duration}s mídia de contexto ${c.assetId} (${c.layout})`
            : `  ${c.id} [${where}] ${c.duration}s componente ${c.component} ${JSON.stringify(c.params)}`,
      );
    }
  }
  if (overlays.length) lines.push("", "## Zooms e componentes já na timeline", ...overlays);

  const media = contextAssets(project);
  if (media.length)
    lines.push(
      "",
      "## Mídias de contexto (b-roll) enviadas pelo usuário",
      "Use com add_broll só onde a fala trata do que a mídia mostra, segundo o nome e a descrição. Você não vê o conteúdo: na dúvida, não use.",
      ...media.map((a) => `  ${a.id} | ${a.kind === "image" ? "imagem" : `vídeo de ${Math.round(a.duration * 10) / 10}s`} | ${a.name}${a.description ? ` — ${a.description}` : ""}`),
    );

  lines.push("", "## Transcrição");
  if (!words.length) {
    lines.push("(sem transcrição disponível neste trecho)");
    return lines.join("\n");
  }

  const hasEnergy = words.some((w) => w.energy !== undefined);
  if (selection) {
    // Trecho curto: precisão por palavra.
    lines.push(...wordLines(project, words));
  } else {
    // Vídeo inteiro: frases curtas; os ids dentro de uma frase são consecutivos.
    lines.push(
      "Formato: [primeira palavra–última palavra | início–fim no vídeo bruto, em s | posição atual na timeline, em s] texto {ritmo e voz}.",
      "Dentro de uma frase os ids são consecutivos (a 3ª palavra de [w10–w17] é w12). Na dúvida, confira com read_words. Pausas longas aparecem como (pausa Xs).",
      hasEnergy
        ? "Voz: \"forte\" lista as palavras ditas com mais energia que o normal do apresentador (dB acima da mediana) — é ali que a ênfase REAL está, não onde o texto parece importante. \"pal/s\" é a velocidade da fala no trecho."
        : "Voz: a energia da fala ainda não foi medida; deduza a ênfase pelo texto e pelas pausas.",
    );
    let seg: TimelineWord[] = [];
    const flush = () => {
      if (!seg.length) return;
      const a = seg[0]!;
      const z = seg[seg.length - 1]!;
      const rate = seg.length >= 3 && z.end > a.start ? ` {${Math.round((seg.length / (z.end - a.start)) * 10) / 10} pal/s` : " {";
      const loud = seg
        .filter((w) => (w.energy ?? 0) >= 3.5 && w.text.replace(/[^\p{L}\p{N}]/gu, "").length > 2)
        .sort((x, y) => (y.energy ?? 0) - (x.energy ?? 0))
        .slice(0, 2)
        .map((w) => `${w.id} "${w.text}" +${Math.round(w.energy!)}dB`);
      const voice = `${rate}${loud.length ? `${rate.length > 2 ? "; " : ""}forte: ${loud.join(", ")}` : ""}}`;
      lines.push(`[${a.id}–${z.id} | ${source.get(a)!.start}–${source.get(z)!.end} | ${a.start}–${z.end}] ${seg.map((w) => w.text).join(" ")}${voice.length > 3 ? voice : ""}`);
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

/** Onde o apresentador está no quadro e quanto espaço sobra para texto. */
function framingLines(project: Project): string[] {
  const duration = projectDuration(project);
  const at = [0.1, 0.5, 0.9].map((f) => subjectAt(project, duration * f)).filter((s) => s !== null);
  if (!at.length) return ["Enquadramento: não analisado. Assuma o apresentador centralizado, com o rosto no terço superior."];
  const avg = (k: "x" | "y" | "w" | "h" | "faceX" | "faceY") => Math.round((at.reduce((s, b) => s + b[k], 0) / at.length) * 100) / 100;
  const x = avg("x");
  const y = avg("y");
  const w = avg("w");
  const pct = (n: number) => `${Math.round(Math.max(0, n) * 100)}%`;
  const left = x;
  const right = 1 - (x + w);
  const moved = at.length > 1 && Math.max(...at.map((b) => b.faceX)) - Math.min(...at.map((b) => b.faceX)) > 0.12;
  return [
    `Enquadramento (medido no vídeo, frações do quadro): apresentador ocupa x ${x}–${Math.round((x + w) * 100) / 100}, do topo ${y} para baixo; rosto em (${avg("faceX")}, ${avg("faceY")})${moved ? "; ele se desloca ao longo do vídeo" : ""}.`,
    `Espaço livre: esquerda ${pct(left)}, direita ${pct(right)}, acima da cabeça ${pct(y)}. ${
      Math.max(left, right) < 0.18
        ? "Quase não há lateral livre: componentes laterais (acronym_list) exigem pan de câmera para o lado oposto, ou use a parte de baixo."
        : `Lado mais livre: ${left > right ? "esquerda" : "direita"} — é onde componentes laterais atrapalham menos.`
    } Zooms sem x/y já fecham no rosto.`,
  ];
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
