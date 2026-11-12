import type { OperationInput } from "./ops";
import { DEFAULT_PACING, type PacingProfile } from "./pacing";

/**
 * Skills: presets de nicho que dirigem o agente. Cada uma tem uma parte
 * determinística (aplicada no navegador, 0 créditos) e uma direção em texto
 * que entra no pedido ao agente.
 */
export type SkillId = "viral" | "autoridade" | "vsl" | "limpeza";

export type Skill = {
  id: SkillId;
  name: string;
  /** Uma linha para o usuário escolher. */
  tagline: string;
  audience: string;
  /** Limpeza determinística antes do agente. */
  local: OperationInput[];
  direction: string;
  /** Orçamento de densidade que o auditor de ritmo cobra nesta skill. */
  pacing: PacingProfile;
};

export const SKILLS: Record<SkillId, Skill> = {
  viral: {
    id: "viral",
    name: "Viral",
    tagline: "Ritmo alto, gancho forte e motion constante",
    audience: "Reels, Shorts e TikTok de dicas práticas",
    local: [
      { op: "remove_retakes" },
      { op: "remove_silences", minSilence: 0.3, padding: 0.07 },
      { op: "set_captions", enabled: true, style: { preset: "karaoke", position: "center", maxWords: 3 } },
    ],
    pacing: { ...DEFAULT_PACING, maxStatic: 6, componentGap: 4, maxPer5s: 3, componentsPerMin: [3, 6], zoomsPerMin: [7, 12], minZoomScale: 1.12 },
    direction: `Estilo viral de alta retenção: o vídeo não pode dar motivo para o dedo rolar.
- Corte tudo que não empurra o vídeo para a frente: takes ruins que sobraram, enrolação, frases de aquecimento antes do gancho ("oi gente", "então", "hoje eu vou falar"). O vídeo começa na primeira frase que promete algo.
- Gancho (0–3s): depth_hook_title sobre a primeira frase, com a promessa do vídeo em 1 a 3 palavras e os textos laterais, mais um punch-in seco.
- Câmera: uma mudança de enquadramento a cada 3–6s. Punch-in seco (1.18–1.25x) nas palavras ditas com mais força, avanço lento nas frases de explicação, pan lateral quando houver lista.
- Motion: uma peça por virada de raciocínio — kinetic_pivot_card para problema → solução, step_progress para etapas, acronym_list quando enumerar, stat_counter em todo número. Cada item entra na palavra em que é dito.
- Fechamento: a última frase (conclusão ou chamada para ação) leva punch-in e, se couber, um componente.`,
  },
  autoridade: {
    id: "autoridade",
    name: "Autoridade",
    tagline: "Sóbrio e elegante, para quem vende confiança",
    audience: "Médicos, advogados, finanças e consultores",
    local: [
      { op: "remove_retakes" },
      { op: "remove_silences", minSilence: 0.6, padding: 0.14 },
      { op: "set_captions", enabled: true, style: { preset: "clean", position: "bottom", maxWords: 6 } },
    ],
    pacing: { ...DEFAULT_PACING, maxStatic: 10, componentGap: 6, fullscreenGap: 12, maxPer5s: 2, componentsPerMin: [2, 4], zoomsPerMin: [4, 7], minZoomScale: 1.1, maxPunchStreak: 1 },
    direction: `Estilo de autoridade: sóbrio, mas editado. Sobriedade está na escolha dos movimentos, não na falta deles — um vídeo parado não passa autoridade, passa amadorismo.
- Fala: preserve as pausas de raciocínio curtas; corte erros, frases abandonadas e qualquer aquecimento antes da primeira afirmação.
- Gancho (0–3s): a afirmação mais forte do começo ganha um avanço lento de câmera e a tarja de nome e credencial (executive_lower_third sem params), se o contexto disser que a tarja está disponível. Sem tarja, abra com um componente que nomeie o assunto.
- Câmera: avanço lento (mode creep, 1.12–1.18x, 4–6s) nas frases que carregam a tese; push-in suave (ease 0.4, 1.15–1.2x) nas conclusões. Nada de punch-in seco em sequência.
- Motion: organize a explicação — acronym_list para os pontos de um diagnóstico, lei ou estratégia (com pan lateral), stat_counter para todo número relevante, kinetic_pivot_card para UM mito → verdade, step_progress para etapas. Textos curtos, sem exclamação.
- Fechamento: a conclusão ou a orientação final leva avanço lento e, quando houver uma frase-síntese, um componente.`,
  },
  vsl: {
    id: "vsl",
    name: "VSL",
    tagline: "Foco em conversão: números e benefícios em destaque",
    audience: "Vídeos de vendas e anúncios",
    local: [
      { op: "remove_retakes" },
      { op: "remove_silences", minSilence: 0.25, padding: 0.06 },
      { op: "set_captions", enabled: true, style: { preset: "bold", position: "bottom", maxWords: 4 } },
    ],
    pacing: { ...DEFAULT_PACING, maxStatic: 7, componentGap: 4, componentsPerMin: [3, 6], zoomsPerMin: [6, 11], minZoomScale: 1.12 },
    direction: `Estilo direct response (VSL): cada segundo precisa vender.
- Cortes rápidos: tire hesitações e qualquer trecho que repita o que já foi dito.
- Gancho (0–3s): a dor ou a promessa em depth_hook_title ou kinetic_pivot_card, com punch-in.
- Todo número, prazo, preço ou resultado aparece em stat_counter na palavra exata; o número mais forte do vídeo vai em tela cheia.
- Dores e benefícios centrais: kinetic_pivot_card (a dor na primeira frase, o benefício na conclusão) ou acronym_list quando forem vários.
- Câmera: punch-in seco nas promessas e na chamada para ação; avanço lento nas histórias e provas.
- Chamada para ação: sempre tratada — punch-in e um componente com a ação que a pessoa deve tomar.`,
  },
  limpeza: {
    id: "limpeza",
    name: "Limpeza",
    tagline: "Só decupagem: erros, silêncios e zooms básicos",
    audience: "Editores em lote e aulas longas",
    local: [{ op: "remove_retakes" }, { op: "remove_silences", minSilence: 0.5, padding: 0.1 }],
    pacing: { ...DEFAULT_PACING, maxStatic: 25, componentsPerMin: [0, 0.5], zoomsPerMin: [2, 6], captions: false, edges: false },
    direction: `Pré-edição para um editor humano terminar: apenas limpeza.
- Revise os takes ruins de confiança media e corte os que forem erro de gravação; mantenha repetições que são ênfase.
- Corte frases abandonadas, falas para a câmera/equipe ("tá gravando?", "vou de novo") e trechos claramente fora do conteúdo.
- Um zoom suave (escala 1.12–1.15) em cada mudança de tópico, e só.
- Não adicione componentes de motion nem mexa nas legendas.`,
  },
};

export function skillPrompt(skill: Skill): string {
  return `Edite este vídeo com a skill "${skill.name}", do início ao fim, deixando pronto para publicar.\n\n${skill.direction}\n\nUma limpeza determinística (takes ruins de confiança alta e silêncios) já rodou, mas ela só enxerga repetição literal e pausa: a revisão da fala continua sendo sua.`;
}
