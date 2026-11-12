import type { OperationInput } from "./ops";

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
    direction: `Estilo viral de alta retenção.
- Corte tudo que não empurra o vídeo para a frente: takes ruins que sobraram, enrolação, frases de aquecimento antes do gancho.
- Gancho: nos 3 primeiros segundos, destaque a promessa do vídeo com um componente de texto de impacto.
- Câmera: alterne o enquadramento a cada 3–6 s. Use punch-in seco (ease 0, escala 1.15–1.3) nas ênfases e nas trocas de frase; nunca deixe mais de 8 s sem mudança visual.
- Motion: a cada ideia nova, um componente (lista quando enumerar, contador quando citar número, destaque de texto na frase-chave). Sincronize cada item com a palavra em que é dito.`,
  },
  autoridade: {
    id: "autoridade",
    name: "Autoridade",
    tagline: "Sóbrio e elegante, para quem vende confiança",
    audience: "Médicos, advogados, finanças e consultores",
    local: [
      { op: "remove_retakes" },
      { op: "remove_silences", minSilence: 0.7, padding: 0.15 },
      { op: "set_captions", enabled: true, style: { preset: "clean", position: "bottom", maxWords: 6 } },
    ],
    direction: `Estilo de autoridade executiva: sobriedade acima de tudo.
- Preserve as pausas de raciocínio; corte só erros de gravação e silêncios longos que sobraram.
- Abra com a tarja de nome e credencial (lower_third, sem params de nome: ela usa o Brand Kit) sobre a primeira frase.
- Câmera: poucos zooms, lentos e suaves (escala 1.06–1.12, ease 1.5 ou mais, 4–6 s) nas frases mais importantes. Nada de punch-in seco.
- Motion: no máximo um componente por minuto, só para organizar a explicação (lista de pontos, um número relevante). Sem efeitos chamativos.`,
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
    direction: `Estilo direct response (VSL): cada segundo precisa vender.
- Cortes rápidos: tire hesitações e qualquer trecho que repita o que já foi dito.
- Sempre que a pessoa citar um número, prazo, preço ou resultado, mostre-o com contador (counter) ou gráfico, sincronizado com a palavra.
- Destaque em texto as dores e os benefícios centrais (text_highlight), no momento em que são ditos.
- Câmera: punch-in seco nas promessas e na chamada para ação; zoom lento nas histórias.`,
  },
  limpeza: {
    id: "limpeza",
    name: "Limpeza",
    tagline: "Só decupagem: erros, silêncios e zooms básicos",
    audience: "Editores em lote e aulas longas",
    local: [{ op: "remove_retakes" }, { op: "remove_silences", minSilence: 0.5, padding: 0.1 }],
    direction: `Pré-edição para um editor humano terminar: apenas limpeza.
- Revise os takes ruins de confiança media e corte os que forem erro de gravação; mantenha repetições que são ênfase.
- Corte frases abandonadas, falas para a câmera/equipe ("tá gravando?", "vou de novo") e trechos claramente fora do conteúdo.
- Um zoom suave (escala 1.1–1.15) em cada mudança de tópico, e só.
- Não adicione componentes de motion nem mexa nas legendas.`,
  },
};

export function skillPrompt(skill: Skill): string {
  return `Edite este vídeo com a skill "${skill.name}".\n\n${skill.direction}\n\nA limpeza determinística (takes ruins de confiança alta e silêncios) já foi aplicada; não repita remove_silences nem remove_retakes.`;
}
