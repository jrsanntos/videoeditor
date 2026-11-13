import type { OperationInput } from "./ops";
import { DEFAULT_PACING, type PacingProfile } from "./pacing";
import { defaultBrandKit, type BrandKit, type CaptionPreset, type Genre, type LookId, type MusicMood, type Project } from "./schema";
import { mgStats, type MotionGraphic } from "./motion-graphic";
import { timelineWords } from "./timeline";

/**
 * Skills: os modelos prontos que dirigem o agente. Cada um é uma arquitetura
 * completa — paleta, tipografia, legenda, ritmo de corte, tratamento de cor,
 * trilha, SFX e cards próprios — com uma parte determinística (aplicada no
 * navegador, 0 créditos) e uma direção em texto que entra no pedido ao agente.
 */
export type SkillId = "viral" | "acao" | "autoridade" | "limpeza";

export type Skill = {
  id: SkillId;
  name: string;
  /** Uma linha para o usuário escolher. */
  tagline: string;
  audience: string;
  /** Formato em que o modelo foi pensado. */
  focus: string;
  /** Gêneros de material em que o modelo rende mais. */
  genres: Genre[];
  /** Limpeza e acabamento determinísticos antes do agente. */
  local: OperationInput[];
  /** Identidade visual do modelo; só é aplicada se o usuário ainda não personalizou o Brand Kit. */
  brand: Partial<BrandKit>;
  /** Resumo do acabamento, para a interface e para os testes. */
  recipe: { captions: CaptionPreset | null; look: LookId; music: MusicMood; sfx: string[]; cards: string[]; speedRamps: boolean; cutZoom: boolean };
  direction: string;
  /** Orçamento de densidade que o auditor de ritmo cobra nesta skill. */
  pacing: PacingProfile;
};

/**
 * Regras de direção de arte: valem para todo texto e toda peça de motion,
 * prontos ou gerados. O agente as recebe no prompt e o crítico as confere.
 */
export const ART_DIRECTION = `Direção de arte (vale para componentes prontos e para custom_motion_graphic):
- Proibido repetir na tela o que já está sendo falado: o texto resume, nomeia ou quantifica — nunca transcreve a frase. A legenda já cuida da fala.
- Títulos com pelo menos 64 px no formato 9:16 (lê-se no celular a um braço de distância).
- Pausa final limpa: toda animação termina e a peça fica parada por pelo menos 0,5 s antes de sair.
- Uma ideia por peça, no máximo 3 níveis de hierarquia (título, apoio, rótulo). Sem texto por cima do rosto.
- Zero clichê visual genérico de IA: nada de emoji decorativo, brilhos, foguetes, gradiente roxo-azul neon, ícones soltos sem função. Cor vem do Brand Kit.
- Cada movimento tem motivo: entra junto com a ideia, na palavra ou no pico de ação correspondente.
- Sentido antes de forma: marcadores, cores e ícones dizem a verdade do conteúdo. ✓ nunca marca o que é proibido, errado ou contra-indicado; ✕ nunca marca o que é recomendado. Em dúvida, use marcadores neutros.`;

export type ArtIssue = { code: "titulo_pequeno" | "cliche" | "sem_pausa_final" | "texto_longo"; message: string };

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2728}\u{2B50}\u{26A1}\u{2705}\u{1F4A1}]/u;

function hue(hex: string): { h: number; s: number } | null {
  if (!/^#[0-9a-fA-F]{6}/.test(hex)) return null;
  const n = parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.001) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: d / max };
}

/**
 * Confere uma peça gerada contra as regras de direção de arte que dá para
 * medir. `duration` (do clip), quando informada, habilita a regra da pausa final.
 */
export function checkArtDirection(spec: MotionGraphic, opts: { vertical: boolean; duration?: number }): ArtIssue[] {
  const issues: ArtIssue[] = [];
  const stats = mgStats(spec.root);
  const titles = stats.texts.filter((t) => t.role === "title");
  const biggest = stats.texts.reduce((m, t) => Math.max(m, t.size), 0);
  if (opts.vertical && stats.texts.length) {
    const small = titles.find((t) => t.size < 64);
    if (small) issues.push({ code: "titulo_pequeno", message: `título "${small.text}" com ${small.size} px: no 9:16 o mínimo é 64 px` });
    else if (!titles.length && biggest < 64) issues.push({ code: "titulo_pequeno", message: `o maior texto da peça tem ${biggest} px: no 9:16 o texto principal precisa de pelo menos 64 px` });
  }
  for (const t of stats.texts) {
    if (EMOJI.test(t.text)) issues.push({ code: "cliche", message: `"${t.text}" usa emoji decorativo: é clichê visual de IA. Use tipografia e forma.` });
    if (t.role === "title" && t.text.replace(/\*/g, "").split(/\s+/).length > 7) issues.push({ code: "texto_longo", message: `título "${t.text}" com mais de 7 palavras: resuma (o texto não transcreve a fala)` });
  }
  const json = JSON.stringify(spec.root);
  for (const m of json.matchAll(/"from":"(#[0-9a-fA-F]{6})[0-9a-fA-F]*","to":"(#[0-9a-fA-F]{6})/g)) {
    const a = hue(m[1]!);
    const b = hue(m[2]!);
    // Roxo/violeta → azul/rosa saturados: o gradiente "de IA".
    if (a && b && a.s > 0.5 && b.s > 0.5 && a.h >= 235 && a.h <= 300 && ((b.h >= 190 && b.h <= 330) || b.h <= 10)) issues.push({ code: "cliche", message: `gradiente ${m[1]} → ${m[2]} é o roxo-azul neon genérico: use as cores do Brand Kit` });
  }
  if (opts.duration !== undefined && stats.animEnd > opts.duration - spec.exit - 0.5 + 1e-6)
    issues.push({ code: "sem_pausa_final", message: `as animações terminam em ${stats.animEnd.toFixed(1)}s e a peça dura ${opts.duration.toFixed(1)}s: falta a pausa final limpa de 0,5 s antes da saída` });
  return issues;
}

const isDefaultBrand = (b: BrandKit) => {
  const d = defaultBrandKit();
  return b.primaryColor === d.primaryColor && b.secondaryColor === d.secondaryColor && b.backgroundColor === d.backgroundColor && b.textColor === d.textColor && b.fontPair === d.fontPair;
};

/**
 * Operações determinísticas de um modelo para ESTE projeto: o que depende de
 * fala só entra quando há fala; a identidade visual só entra se o usuário
 * ainda está no Brand Kit padrão (a marca dele sempre vence).
 */
export function skillOperations(skill: Skill, project: Project): OperationInput[] {
  const hasWords = timelineWords(project).length > 0;
  const ops = skill.local.filter((op) => hasWords || (op.op !== "remove_retakes" && op.op !== "remove_fillers" && op.op !== "remove_silences" && op.op !== "set_captions"));
  if (Object.keys(skill.brand).length && isDefaultBrand(project.brand)) ops.push({ op: "set_brand", brand: skill.brand });
  return ops.map((op) => (op.op === "set_look" && project.aspectRatio === "9:16" && op.look.letterbox ? { ...op, look: { ...op.look, letterbox: Math.min(op.look.letterbox, 0.05) } } : op));
}

export const SKILLS: Record<SkillId, Skill> = {
  viral: {
    id: "viral",
    name: "Retenção Viral & Creator Pro",
    tagline: "Gancho em 2 s, legenda pop na base e ritmo que não deixa rolar o dedo",
    audience: "Reels, Shorts e TikTok de dicas práticas",
    focus: "9:16 — Shorts / Reels",
    genres: ["talking_head", "vlog_montage"],
    local: [
      { op: "remove_retakes" },
      { op: "remove_fillers", level: "all" },
      { op: "remove_silences", mode: "aggressive" },
      { op: "set_captions", enabled: true, style: { preset: "viral_pop", position: "bottom", maxWords: 3, highlightColor: "#FFE14D" } },
      { op: "set_look", look: { grade: "clean_punch", intensity: 0.7, vignette: 0.15, letterbox: 0 } },
      { op: "set_music", music: { mood: "upbeat", volume: 0.35, duck: true } },
      { op: "set_format", finish: { cutZoom: true, voice: true }, sfx: { enabled: true } },
    ],
    brand: { primaryColor: "#FFE14D", secondaryColor: "#FF4D6D", backgroundColor: "#0A0A0F", textColor: "#FFFFFF", fontPair: "poppins-playfair" },
    recipe: { captions: "viral_pop", look: "clean_punch", music: "upbeat", sfx: ["pop", "whoosh_rapido", "riser"], cards: ["depth_hook_title", "stat_counter_card", "social_proof_toast", "kinetic_pivot_card"], speedRamps: false, cutZoom: true },
    pacing: { ...DEFAULT_PACING, maxStatic: 6, componentGap: 4, maxPer5s: 3, componentsPerMin: [3, 6], zoomsPerMin: [7, 12], minZoomScale: 1.08 },
    direction: `Modelo "Retenção Viral & Creator Pro" (9:16): o vídeo não pode dar motivo para o dedo rolar.
- Corte tudo que não empurra o vídeo para a frente: takes ruins que sobraram, enrolação, frases de aquecimento antes do gancho ("oi gente", "então", "hoje eu vou falar"). O vídeo começa na primeira frase que promete algo.
- Gancho visual nos primeiros 2 s: um card de impacto (depth_hook_title, ou stat_counter_card se a promessa for um número) sobre a primeira frase, com a promessa em 1 a 3 palavras, mais um add_sfx riser terminando no corte e um pop na entrada do card.
- Micro-zooms nos cortes: a plataforma já alterna 1,08x a cada corte; acrescente punch-in seco (1.18–1.25x) só nas palavras ditas com mais força, e avanço lento nas explicações.
- Cards: um por virada de raciocínio — kinetic_pivot_card para problema → solução, comparison_split para antes/depois, stat_counter_card em todo número, social_proof_toast para prova social, step_progress_bar quando houver etapas. A legenda some sozinha enquanto um card está na tela.
- SFX: whoosh_rapido nas transições de assunto, pop nas entradas de item. A trilha animada já está ligada com ducking: não mexa.
- Fechamento: a última frase (conclusão ou chamada para ação) leva punch-in e um card.`,
  },
  acao: {
    id: "acao",
    name: "Ação & Cinematográfico",
    tagline: "Câmera lenta nos ápices, cor de cinema, impactos e trilha de ação",
    audience: "Cenas dinâmicas, esportes, treinos e operações",
    focus: "Cenas visuais com pouca fala",
    genres: ["action_cinematic", "vlog_montage"],
    local: [
      { op: "set_look", look: { grade: "tactical_teal_orange", intensity: 0.9, vignette: 0.55, letterbox: 0.1 } },
      { op: "set_music", music: { mood: "action", volume: 0.6, duck: true } },
      { op: "set_captions", enabled: true, style: { preset: "minimal_cinema", position: "bottom", maxWords: 6 } },
      { op: "set_format", finish: { cutZoom: false, voice: true }, sfx: { enabled: true, volume: 1 } },
    ],
    brand: { primaryColor: "#F97316", secondaryColor: "#2DD4BF", backgroundColor: "#05080A", textColor: "#F1F5F9", fontPair: "anton-playfair" },
    recipe: { captions: "minimal_cinema", look: "tactical_teal_orange", music: "action", sfx: ["impacto_cinematico", "sub_drop", "impacto_grave", "whoosh_rapido", "riser", "zoom_punch"], cards: ["tactical_hud_overlay", "depth_hook_title", "callout_pointer"], speedRamps: true, cutZoom: false },
    pacing: { ...DEFAULT_PACING, maxStatic: 12, componentGap: 5, maxPer5s: 3, componentsPerMin: [1, 3], zoomsPerMin: [2, 6], minZoomScale: 1.1, captions: false },
    direction: `Modelo "Ação & Cinematográfico": a edição segue a IMAGEM e o SOM da cena, não as palavras.
- NÃO corte pausas por falta de fala e não use remove_silences: silêncio com ação é a cena. Corte só tempo morto de verdade (cut_source), como câmera sendo ajustada antes de começar.
- Estruture em atos pelo mapa de ação: gancho (o plano mais forte primeiro, nos 2 s iniciais), desenvolvimento (preparo, tensão), clímax (o pico de energia mais forte) e fecho.
- Rampas de velocidade (speed_ramp, ancoradas com atSource/untilSource), SEMPRE antes de zooms e textos: câmera lenta dramática (rate 0.4–0.6) em 1,5–3 s de bruto ao redor dos picos de energia mais fortes — o preparo e o impacto; aceleração (rate 1.4–2.0) nos deslocamentos e esperas entre um pico e outro. Pelo menos 2 rampas num vídeo de 30 s ou mais; nunca duas câmeras lentas coladas.
- Som sincronizado: a trilha de ação já está ligada com ducking sob as falas. Em cada pico forte, add_sfx com o pico do som no pico da imagem — impacto_cinematico no clímax (uma vez), impacto_grave nos outros golpes, sub_drop na entrada da câmera lenta, whoosh_rapido nas acelerações e trocas de plano, riser terminando no clímax, zoom_punch nos punch-ins.
- Câmera: add_impact (flash/shake) só nos 2–4 picos mais fortes. Zooms com motivo e direcionados ao sujeito (omita x/y: fecham no centro de massa detectado); nada de zoom aleatório no centro. Punch-in seco no impacto; avanço lento na tensão.
- Tratamento visual: a grade de alto contraste, a vinheta dinâmica e o letterbox já estão aplicados (set_look); ajuste só se o usuário pedir outro clima.
- Texto: pouco e forte. tactical_hud_overlay (telemetria, timestamp, status) nos trechos de operação; um título cinético de impacto no gancho (depth_hook_title, 1–2 palavras); callout_pointer para apontar um detalhe. Nada de lista, contador ou tarja. Legenda discreta na base só onde houver fala.`,
  },
  autoridade: {
    id: "autoridade",
    name: "Autoridade & Documentário Moderno",
    tagline: "Tom quente e limpo, dados em cartões e câmera suave",
    audience: "Explicativos, negócios, saúde, direito e educação",
    focus: "Explicativo — 9:16 ou 16:9",
    genres: ["talking_head", "tutorial_demo"],
    local: [
      { op: "remove_retakes" },
      { op: "remove_fillers", level: "hesitations" },
      { op: "remove_silences", mode: "natural" },
      { op: "set_captions", enabled: true, style: { preset: "editorial_clean", position: "bottom", maxWords: 6 } },
      { op: "set_look", look: { grade: "warm_cinematic", intensity: 0.75, vignette: 0.2, letterbox: 0 } },
      { op: "set_music", music: { mood: "ambient", volume: 0.28, duck: true } },
      { op: "set_format", finish: { cutZoom: true, voice: true }, sfx: { enabled: true, volume: 0.7 } },
    ],
    brand: { primaryColor: "#D9A441", secondaryColor: "#7BA7BC", backgroundColor: "#14110F", textColor: "#F5EFE6", fontPair: "montserrat-playfair" },
    recipe: { captions: "editorial_clean", look: "warm_cinematic", music: "ambient", sfx: ["swoosh_texto", "click_suave", "ding"], cards: ["stat_counter_card", "comparison_split", "step_progress_bar", "acronym_list"], speedRamps: false, cutZoom: true },
    pacing: { ...DEFAULT_PACING, maxStatic: 10, componentGap: 6, fullscreenGap: 12, maxPer5s: 2, componentsPerMin: [2, 4], zoomsPerMin: [4, 7], minZoomScale: 1.1, maxPunchStreak: 1 },
    direction: `Modelo "Autoridade & Documentário Moderno": sóbrio, mas editado. Sobriedade está na escolha dos movimentos, não na falta deles.
- Fala: preserve as pausas de raciocínio curtas; corte erros, frases abandonadas e qualquer aquecimento antes da primeira afirmação. Os sons de hesitação já saíram; "né" e "tipo" soltos ficam a seu critério (tire os que atrapalham o ritmo, mantenha os que soam naturais).
- Gancho (0–3s): a afirmação mais forte do começo ganha um avanço lento de câmera e um cartão que nomeie o assunto. Se o contexto disser que a tarja está disponível, apresente quem fala com executive_lower_third uma vez, logo depois do gancho (entre 2 e 6 s, por 4–5 s, sem disputar espaço com o cartão); se estiver indisponível, não use.
- Câmera suave (Ken Burns): avanço lento (mode creep, 1.12–1.18x, 4–6 s) nas frases que carregam a tese; push-in com ease 0.4–0.5 (ease-out, 1.15–1.2x) nas conclusões. Nada de punch-in seco em sequência, nada de impacto de câmera.
- Cartões de dados: stat_counter_card para todo número relevante (com a barra de progresso quando for porcentagem), comparison_split para UM antes/depois ou mito/verdade, step_progress_bar no topo quando a explicação tiver etapas, acronym_list para os pontos de um diagnóstico ou estratégia. Textos curtos, sem exclamação.
- Som: a trilha ambiente sutil já está ligada com ducking; efeitos discretos só nas entradas de cartão.
- Fechamento: a conclusão ou a orientação final leva avanço lento e, quando houver uma frase-síntese, um cartão.`,
  },
  limpeza: {
    id: "limpeza",
    name: "Limpeza",
    tagline: "Só decupagem: erros, silêncios e zooms básicos",
    audience: "Editores em lote e aulas longas",
    focus: "Pré-edição",
    genres: ["talking_head", "tutorial_demo"],
    local: [{ op: "remove_retakes" }, { op: "remove_fillers", level: "all" }, { op: "remove_silences", mode: "aggressive" }],
    brand: {},
    recipe: { captions: null, look: "none", music: "none", sfx: [], cards: [], speedRamps: false, cutZoom: true },
    pacing: { ...DEFAULT_PACING, maxStatic: 25, componentsPerMin: [0, 0.5], zoomsPerMin: [2, 6], captions: false, edges: false },
    direction: `Pré-edição para um editor humano terminar: apenas limpeza.
- Revise os takes ruins de confiança media e corte os que forem erro de gravação; mantenha repetições que são ênfase.
- Corte frases abandonadas, falas para a câmera/equipe ("tá gravando?", "vou de novo") e trechos claramente fora do conteúdo.
- Um zoom suave (escala 1.12–1.15) em cada mudança de tópico, e só.
- Não adicione componentes de motion nem mexa nas legendas.`,
  },
};

/** Os três modelos prontos, na ordem em que aparecem para o usuário. */
export const TEMPLATE_SKILLS: SkillId[] = ["viral", "acao", "autoridade"];

/** Modelo sugerido para o gênero do material. */
export function skillForGenre(genre: Genre | null): SkillId {
  return genre === "action_cinematic" || genre === "vlog_montage" ? "acao" : genre === "tutorial_demo" ? "autoridade" : "viral";
}

export function skillPrompt(skill: Skill): string {
  const local = skill.id === "acao" ? "O tratamento de cor, a trilha e as legendas do modelo já foram aplicados; as rampas de velocidade, os sons e os textos são seus." : "Uma limpeza determinística (takes ruins de confiança alta, muletas e silêncios) e o acabamento do modelo (legenda, cor, trilha) já rodaram, mas a limpeza só enxerga repetição literal e pausa: a revisão da fala continua sendo sua.";
  return `Edite este vídeo com o modelo "${skill.name}", do início ao fim, deixando pronto para publicar.\n\n${skill.direction}\n\n${local}`;
}
