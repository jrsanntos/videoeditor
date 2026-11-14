import { cutPoints, timelinePeaks } from "./analysis";
import { faceBox, isCloseUp, type Box } from "./layout";
import { MotionGraphicSchema } from "./motion-graphic";
import type { ComponentClip, Project, ZoomClip } from "./schema";
import { checkArtDirection, type Skill } from "./skills";
import { clipEnd, hasSpeed, mainClips, projectDuration, projectGenre, r3, subjectAt, timelineWords } from "./timeline";

/**
 * Crítico: a autoavaliação da edição antes da entrega. Tudo aqui é
 * determinístico — o que dá para medir não depende do gosto de um modelo.
 * O laudo volta ao Editor por até MAX_CRITIC_CYCLES ciclos de autocorreção.
 */
export const MAX_CRITIC_CYCLES = 3;

export type CritiqueIssue = {
  severity: "erro" | "aviso";
  code: "texto_repete_fala" | "zoom_sem_motivo" | "zoom_fora_do_sujeito" | "texto_no_rosto" | "som_incompleto" | "direcao_de_arte" | "acao_sem_tratamento" | "sem_espaco_no_quadro";
  message: string;
  clipIds?: string[];
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * O que não cabe NESTE quadro, independentemente da receita do estilo. Um
 * editor profissional olha a cena antes de pôr um efeito: título gigante atrás
 * da cabeça só funciona com a pessoa pequena no quadro; em close-up a cabeça
 * tapa o título e os textos laterais caem em cima do rosto.
 * Devolve uma explicação por clip que não cabe.
 */
export function framingObjections(project: Project, clips?: ComponentClip[]): { clipId: string; message: string }[] {
  const aspect = project.width / project.height;
  const list = clips ?? project.tracks.flatMap((t) => t.clips).filter((c): c is ComponentClip => c.type === "component");
  const out: { clipId: string; message: string }[] = [];
  for (const c of list) {
    if (c.component !== "depth_hook_title") continue;
    const s = subjectAt(project, c.start + Math.min(0.5, c.duration / 2));
    if (!s || !isCloseUp(s, aspect)) continue;
    const f = faceBox(s, aspect);
    out.push({
      clipId: c.id,
      message: `depth_hook_title não cabe neste trecho: é um close-up (o rosto ocupa ${pct(f.w)} da largura e ${pct(f.h)} da altura do quadro). A cabeça tapa o título gigante e os textos laterais caem no rosto. Não force a receita: aqui o gancho é a própria fala — corte seco no começo, um zoom no rosto e a legenda. Use texto na tela só se o conteúdo pedir (um número, uma lista dita em voz alta) e ele vai para baixo do queixo.`,
    });
  }
  return out;
}

/** Texto de um componente desenhado na tela em `t`, em frações do quadro (vem da sonda do renderer). */
export type ScreenText = { clipId: string; t: number; box: Box };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      // Cores, ids e caminhos vetoriais não são texto lido pelo espectador.
      if (k === "d" || k === "type" || k === "prop" || k === "ease" || /color|fill|stroke|accent|anchor|layout|align|font|backdrop/i.test(k)) continue;
      strings(v, out);
    }
  return out;
}

/** O texto transcreve a fala? Sequência contígua de 3+ palavras ditas enquanto ele está na tela. */
function repeatsSpeech(text: string, spoken: string[]): boolean {
  const tokens = norm(text.replace(/\*/g, ""));
  if (tokens.length < 3 || spoken.length < tokens.length) return false;
  const need = tokens.length <= 4 ? tokens.length : Math.ceil(tokens.length * 0.8);
  for (let i = 0; i + need <= spoken.length; i++) {
    let run = 0;
    for (let j = 0; j < tokens.length && i + j < spoken.length; j++) if (spoken[i + j] === tokens[j]) run++;
    if (run >= need) return true;
  }
  return false;
}

export function critiqueEdit(project: Project, opts: { skill?: Skill; screen?: ScreenText[] } = {}): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];
  const words = timelineWords(project);
  const duration = projectDuration(project);
  const aspect = project.width / project.height;
  const clips = project.tracks.flatMap((t) => t.clips);
  const components = clips.filter((c): c is ComponentClip => c.type === "component");
  const zooms = clips.filter((c): c is ZoomClip => c.type === "zoom").sort((a, b) => a.start - b.start);

  // 1. Texto na tela repetindo a fala.
  for (const c of components) {
    const spoken = norm(
      words
        .filter((w) => w.end > c.start - 1 && w.start < clipEnd(c) + 1)
        .map((w) => w.text)
        .join(" "),
    );
    const hit = strings(c.params).find((s) => repeatsSpeech(s, spoken));
    if (hit)
      issues.push({ severity: "erro", code: "texto_repete_fala", clipIds: [c.id], message: `${c.component} (${c.id}) mostra "${hit.replace(/\*/g, "")}", que é exatamente o que está sendo falado nesse trecho. O texto na tela resume, nomeia ou quantifica — nunca transcreve (a legenda já faz isso). Reescreva em 1–3 palavras ou remova.` });
  }

  // 2. Zooms sem motivação: nada acontece na fala, na imagem ou na edição perto de onde o zoom começa.
  const reasons: number[] = [...cutPoints(project), ...timelinePeaks(project).map((p) => p.t), ...clips.filter((c) => c.type === "component" || c.type === "impact" || c.type === "sfx").map((c) => c.start), 0];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if ((w.energy ?? 0) >= 3 || !prev || w.start - prev.end >= 0.45 || /[.!?]$/.test(prev.text)) reasons.push(w.start);
  });
  for (const c of mainClips(project)) if (hasSpeed(c)) reasons.push(c.start, clipEnd(c));
  const unmotivated = zooms.filter((z) => !reasons.some((t) => Math.abs(t - z.start) <= 0.7));
  if (unmotivated.length)
    issues.push({
      severity: zooms.length >= 2 && unmotivated.length / zooms.length > 0.5 ? "erro" : "aviso",
      code: "zoom_sem_motivo",
      clipIds: unmotivated.map((z) => z.id),
      message: `${unmotivated.length} de ${zooms.length} zoom(s) começam onde nada acontece (sem ênfase na voz, início de frase, corte ou pico de ação por perto): ${unmotivated.map((z) => `${z.id} em ${z.start}s`).join(", ")}. Zoom aleatório é pior que nenhum: ancore num motivo ou remova.`,
    });
  for (const z of zooms) {
    const s = subjectAt(project, z.start + z.duration / 2);
    if (s && z.scale >= 1.15 && Math.hypot(z.x - s.faceX, z.y - s.faceY) > 0.22)
      issues.push({ severity: "aviso", code: "zoom_fora_do_sujeito", clipIds: [z.id], message: `O zoom ${z.id} fecha em (${z.x}, ${z.y}), longe do sujeito detectado em (${s.faceX}, ${s.faceY}). Omita x/y para o zoom seguir o centro de massa do sujeito.` });
  }

  // 3. Texto de componente na frente do rosto (medido no quadro, pela sonda do renderer).
  const onFace = new Map<string, number>();
  for (const r of opts.screen ?? []) {
    const s = subjectAt(project, r.t);
    if (!s) continue;
    const f = faceBox(s, aspect);
    const ix = Math.min(r.box.x + r.box.w, f.x + f.w) - Math.max(r.box.x, f.x);
    const iy = Math.min(r.box.y + r.box.h, f.y + f.h) - Math.max(r.box.y, f.y);
    // Qualquer pedaço do rosto coberto (mais que uma beirada) já é defeito.
    if (ix > 0 && iy > 0 && (ix * iy) / (f.w * f.h) > 0.04 && !onFace.has(r.clipId)) onFace.set(r.clipId, r.t);
  }
  for (const [clipId, t] of onFace) {
    const c = components.find((k) => k.id === clipId);
    // Atrás da pessoa é o efeito do gancho, não uma colisão; tela cheia cobre o apresentador de propósito.
    if (!c || c.component === "depth_hook_title") continue;
    issues.push({ severity: "erro", code: "texto_no_rosto", clipIds: [clipId], message: `${c.component} (${clipId}) cobre o rosto em ${r3(t)}s. Mova para a área livre (outro lado, parte de baixo) ou encurte o texto.` });
  }

  for (const o of framingObjections(project, components)) issues.push({ severity: "erro", code: "sem_espaco_no_quadro", clipIds: [o.clipId], message: `${o.message} Remova o clip ${o.clipId}.` });

  // 4. Acabamento sonoro completo.
  const wantsMusic = opts.skill ? opts.skill.recipe.music !== "none" : projectGenre(project) === "action_cinematic";
  const hasMusic = project.music.mood !== "none" || !!project.music.assetId;
  if (wantsMusic && !hasMusic) issues.push({ severity: "erro", code: "som_incompleto", message: "O vídeo está sem trilha de fundo. Use set_music com o clima do vídeo (com ducking sob a voz)." });
  if (hasMusic && !project.music.duck && words.length) issues.push({ severity: "aviso", code: "som_incompleto", message: "A trilha está sem ducking: ela disputa com a voz. Ligue duck em set_music." });
  if (!project.sfx.enabled) issues.push({ severity: "aviso", code: "som_incompleto", message: "Os efeitos sonoros estão desligados: entradas e cortes ficam secos." });

  // 5. Direção de arte das peças geradas.
  for (const c of components) {
    if (c.component !== "custom_motion_graphic") continue;
    const spec = MotionGraphicSchema.safeParse(c.params);
    if (!spec.success) continue;
    for (const i of checkArtDirection(spec.data, { vertical: project.height > project.width, duration: c.duration }))
      issues.push({ severity: i.code === "sem_pausa_final" ? "aviso" : "erro", code: "direcao_de_arte", clipIds: [c.id], message: `custom_motion_graphic (${c.id}): ${i.message}.` });
  }

  // 6. Vídeo de ação sem o vocabulário da ação.
  if ((opts.skill?.recipe.speedRamps || projectGenre(project) === "action_cinematic") && duration >= 20) {
    const ramps = mainClips(project).filter(hasSpeed).length;
    const sfx = clips.filter((c) => c.type === "sfx").length;
    if (!ramps) issues.push({ severity: "erro", code: "acao_sem_tratamento", message: "Vídeo de ação sem nenhuma rampa de velocidade. Use speed_ramp: câmera lenta (0.4–0.6) nos picos de energia e aceleração (1.4–2.0) nos deslocamentos." });
    if (project.look.grade === "none") issues.push({ severity: "erro", code: "acao_sem_tratamento", message: "Vídeo de ação sem tratamento de cor. Use set_look (grade de alto contraste e vinheta)." });
    if (!sfx) issues.push({ severity: "erro", code: "acao_sem_tratamento", message: "Vídeo de ação sem efeitos sonoros sincronizados. Use add_sfx nos picos de energia (impacto, sub_drop, whoosh)." });
  }
  return issues;
}

export function critiqueReport(issues: CritiqueIssue[]): string {
  if (!issues.length) return "Crítico: nenhum problema encontrado.";
  const errors = issues.filter((i) => i.severity === "erro");
  const warnings = issues.filter((i) => i.severity === "aviso");
  return ["Laudo do Crítico (autoavaliação da montagem):", ...(errors.length ? ["Corrija (obrigatório):", ...errors.map((i) => `- [${i.code}] ${i.message}`)] : []), ...(warnings.length ? ["Avalie:", ...warnings.map((i) => `- [${i.code}] ${i.message}`)] : [])].join("\n");
}

/**
 * timeline_view em texto: a tira de diagnóstico que acompanha as miniaturas.
 * Uma linha por ponto de corte, com o que está na tela, a voz e o sujeito.
 */
export function timelineView(project: Project): string {
  const words = timelineWords(project);
  const clips = project.tracks.flatMap((t) => t.clips);
  const points = [0, ...cutPoints(project)].filter((t, i, a) => i === 0 || t - a[i - 1]! > 0.05);
  const lines = ["timeline_view (ponto de corte | vídeo | na tela | fala | sujeito):"];
  for (const t of points.slice(0, 40)) {
    const main = mainClips(project).find((c) => t >= c.start - 0.001 && t < clipEnd(c) - 0.001);
    const on = clips.filter((c) => c.type !== "media" && c.start <= t + 0.3 && clipEnd(c) > t + 0.05).map((c) => (c.type === "component" ? c.component : c.type === "zoom" ? `zoom ${c.scale}x` : c.type));
    const said = words
      .filter((w) => w.start >= t - 0.05 && w.start < t + 1.5)
      .map((w) => w.text)
      .join(" ");
    const s = subjectAt(project, t + 0.1);
    lines.push(
      `${r3(t)}s | ${main ? `${main.id}${hasSpeed(main) ? ` (${main.speedRamp ? "rampa" : `${main.speed}x`})` : ""}` : "lacuna"} | ${on.join(", ") || "—"} | ${said ? `"${said}"` : "sem fala"} | ${s ? `rosto (${s.faceX}, ${s.faceY})` : "não medido"}`,
    );
  }
  return lines.join("\n");
}
