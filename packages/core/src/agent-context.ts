import { GENRE_NAMES, type Project, type StyleReferenceProfile, type TimeRange } from "./schema";
import { findRetakes } from "./retakes";
import { findFillers } from "./fillers";
import { clipEnd, contextAssets, hasSpeed, mainClips, mainGaps, projectDuration, projectGenre, r3, sourceEnd, subjectAt, timelineWords, type TimelineWord } from "./timeline";
import { timelineActionRanges, timelinePeaks, voiceRanges } from "./analysis";
import { isCloseUp } from "./layout";

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
  lines.push(...genreLines(project));
  lines.push(...framingLines(project));
  lines.push(
    `Acabamento atual: tratamento de cor ${project.look.grade}${project.look.vignette ? `, vinheta ${project.look.vignette}` : ""}${project.look.letterbox ? `, letterbox ${project.look.letterbox}` : ""}; trilha de fundo ${project.music.assetId ?? project.music.mood}${project.music.mood !== "none" || project.music.assetId ? (project.music.duck ? " com ducking" : " sem ducking") : ""}.`,
  );
  if (project.styleReference) lines.push("", ...styleReferenceLines(project.styleReference));
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
            : c.type === "sfx"
              ? `  ${c.id} [${where}] efeito sonoro ${c.sfx} em ${c.start}s`
              : c.type === "impact"
                ? `  ${c.id} [${where}] impacto de câmera ${c.kind} em ${c.start}s`
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

  lines.push(...actionMapLines(project, selection));

  lines.push("", "## Transcrição");
  if (!words.length) {
    lines.push("(sem fala neste trecho: ancore pelo tempo do vídeo bruto com atSource/untilSource, usando o mapa de ação acima)");
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
      "Erros de gravação prováveis, já com o corte exato (mantém o último take). confiança alta: corte. confiança media: leia o trecho e decida — repetição também pode ser ênfase intencional. correction: a pessoa se corrigiu no meio da frase; a informação certa é a que vem DEPOIS da expressão de correção — confira o corte sugerido para manter a frase com sentido e com o dado corrigido.",
    );
    for (const r of takes)
      lines.push(`${r.confidence} | ${r.kind} | cortar {"from":"${r.from}","to":"${r.to}"} "${r.cutText}" → fica "${r.keepText}"`);
  }
  const fillers = findFillers(words);
  if (fillers.length) {
    lines.push(
      "",
      "## Muletas na fala",
      `${fillers.length} muleta(s) ainda na timeline. remove_fillers tira de uma vez (level "hesitations" só os sons; "all" também "tipo", "né", "sabe?" soltos). Para escolher uma a uma, use cut_words.`,
      ...fillers.slice(0, 40).map((f) => `${f.confidence} | ${f.kind} | {"from":"${f.from}","to":"${f.to}"} "${f.text}"`),
    );
  }
  return lines.join("\n");
}

/** Gênero editorial e o playbook que ele pede. */
function genreLines(project: Project): string[] {
  const genre = projectGenre(project);
  if (!genre) return ["Gênero: não classificado (análise do vídeo indisponível). Deduza pela transcrição: muita fala contínua = talking_head."];
  const first = mainClips(project)[0];
  const reason = (first && project.assets[first.assetId]?.analysis?.reason) || "";
  const playbook: Record<typeof genre, string> = {
    talking_head: "Playbook de fala: limpe a fala, cortes nas pausas, ênfase onde a voz enfatiza.",
    action_cinematic:
      "Playbook de AÇÃO: a edição segue a imagem, não as palavras. NÃO corte pausas sem fala. Use rampas de velocidade (speed_ramp 0.4–0.6 na tensão e no impacto; 1.4–2.0 nos deslocamentos), tratamento de cor (set_look), trilha (set_music action) e SFX/impactos nos picos. Zooms só com motivo: no sujeito, num pico de energia.",
    tutorial_demo: "Playbook de demonstração: preserve os passos; zooms no detalhe mostrado, callouts e indicador de etapas; legendas discretas embaixo.",
    vlog_montage: "Playbook de montagem: cortes rítmicos nos picos de energia e mudanças de plano, trilha animada, textos curtos.",
  };
  return [`Gênero: ${genre} (${GENRE_NAMES[genre]})${project.genre ? " — definido pelo usuário" : ""}. ${reason}`, playbook[genre]];
}

/** Referência de inspiração (YouTube) resumida para o Diretor. */
export function styleReferenceLines(ref: StyleReferenceProfile): string[] {
  const lines = [
    "## Referência de inspiração (YouTube)",
    `"${ref.title}"${ref.channel ? ` — ${ref.channel}` : ""}${ref.durationSec ? ` — ${Math.round(ref.durationSec)}s` : ""}. O usuário quer este RITMO e ESTILO aplicados ao vídeo dele; não copie o conteúdo.`,
    `Ritmo: ${ref.pacing.cutsPerMin ? `~${ref.pacing.cutsPerMin} cortes/min, ` : ""}${ref.pacing.avgShotSec ? `plano médio de ${ref.pacing.avgShotSec}s, ` : ""}${ref.pacing.wordsPerMin ? `fala a ${ref.pacing.wordsPerMin} palavras/min, ` : ""}energia ${ref.pacing.energy}.`,
  ];
  if (ref.cutStyle) lines.push(`Cortes: ${ref.cutStyle}`);
  if (ref.structure.length) lines.push(`Estrutura: ${ref.structure.map((s) => `${Math.round(s.t)}s ${s.title}`).join(" → ")}`);
  if (ref.palette.length) lines.push(`Cores: ${ref.palette.join(", ")}`);
  if (ref.typography) lines.push(`Tipografia: ${ref.typography}`);
  if (ref.captions) lines.push(`Legendas: ${ref.captions}`);
  if (ref.guidelines.length) lines.push("Diretrizes:", ...ref.guidelines.map((g) => `- ${g}`));
  return lines;
}

/**
 * Mapa de ação: o que o vídeo tem além da fala. Clips da trilha principal em
 * tempo de origem, lacunas, trechos de alta atividade visual e os picos de
 * energia — tudo ancorável com atSource.
 */
function actionMapLines(project: Project, selection?: TimeRange | null): string[] {
  const clips = [...mainClips(project)].sort((a, b) => a.start - b.start);
  const hasAnalysis = clips.some((c) => project.assets[c.assetId]?.analysis);
  if (!clips.length) return ["", "## Trilha principal", "(vazia: composição sem vídeo. Componentes, textos e sons podem ser posicionados livremente.)"];
  const inScope = (t: number) => !selection || (t >= selection.start && t <= selection.end);
  const lines = ["", "## Vídeo (trilha principal) — tempos do vídeo BRUTO"];
  if (clips.length <= 40)
    for (const c of clips)
      if (!selection || (clipEnd(c) > selection.start && c.start < selection.end))
        lines.push(`  ${c.id} | bruto ${c.sourceStart}–${sourceEnd(c)}s | timeline ${c.start}–${clipEnd(c)}s${hasSpeed(c) ? ` | velocidade ${c.speedRamp ? `rampa ${c.speedRamp.map((p) => `${p.rate}x`).join("→")}` : `${c.speed}x`}` : ""}`);
  else lines.push(`  ${clips.length} clips, do bruto ${clips[0]!.sourceStart}s ao ${sourceEnd(clips[clips.length - 1]!)}s`);
  const gaps = mainGaps(project);
  if (gaps.length) lines.push(`Lacunas (tela preta, deixadas de propósito): ${gaps.map((g) => `${g.start}–${g.end}s`).join(", ")}`);
  if (!hasAnalysis) return lines;
  const voice = voiceRanges(project);
  const total = projectDuration(project);
  const spoken = voice.reduce((s, r) => s + r.end - r.start, 0);
  lines.push(`Voz ativa em ${Math.round((spoken / Math.max(total, 0.001)) * 100)}% da timeline.`);
  const action = timelineActionRanges(project).filter((r) => inScope(r.start) || inScope(r.end));
  if (action.length) lines.push(`Alta atividade visual (não cortar como silêncio), timeline: ${action.slice(0, 14).map((r) => `${r.start}–${r.end}s`).join(", ")}`);
  const peaks = timelinePeaks(project)
    .filter((p) => inScope(p.t))
    .slice(0, 14)
    .sort((a, b) => a.t - b.t);
  if (peaks.length)
    lines.push(
      "Picos de energia (atSource = tempo no bruto | tipo | força 0–1) — é onde impactos, SFX, câmera lenta e cortes rendem mais:",
      ...peaks.map((p) => `  atSource ${p.source} | ${p.kind === "both" ? "visual+áudio" : p.kind === "visual" ? "visual" : "áudio"} | ${p.strength}`),
    );
  const cuts = clips.flatMap((c) => (project.assets[c.assetId]?.analysis?.cuts ?? []).filter((t) => t >= c.sourceStart && t < sourceEnd(c)));
  if (cuts.length) lines.push(`Mudanças de plano no bruto: ${cuts.slice(0, 30).map((t) => `${r3(t)}s`).join(", ")}`);
  return lines;
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
    ...(at.some((b) => isCloseUp(b))
      ? ["CLOSE-UP: o rosto ocupa mais de 35% da altura do quadro (ou está cortado na borda). Texto atrás da cabeça fica ilegível: a plataforma troca sozinha por um cartão em primeiro plano fora do rosto; prefira textos curtos na área livre."]
      : []),
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
