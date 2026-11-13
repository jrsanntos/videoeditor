import { z } from "zod";
import type { OperationInput } from "./ops";
import { CAPTION_PRESET_IDS, LOOK_IDS, MUSIC_MOODS, type Project } from "./schema";
import { SKILLS, skillOperations, TEMPLATE_SKILLS, type SkillId } from "./skills";
import { timelineWords } from "./timeline";

/**
 * Modelo de edição: o "estilo" extraído de um vídeo de exemplo (já editado)
 * para ser reaplicado nos vídeos de outros usuários.
 *
 * Parte é determinística e roda no navegador sem custo (legendas, pausas);
 * o resto vira uma receita que o agente segue (zooms, motion, ritmo).
 */
export const EditTemplateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(280).describe("o que o modelo faz, em uma ou duas frases para o usuário final"),
  captions: z.object({
    enabled: z.boolean(),
    preset: z.enum(CAPTION_PRESET_IDS),
    position: z.enum(["bottom", "center", "top"]),
  }),
  silence: z.object({
    remove: z.boolean().describe("se o exemplo corta pausas"),
    minSilence: z.number().min(0.15).max(3).describe("pausa mínima (s) que o exemplo deixa de manter"),
    padding: z.number().min(0).max(0.5).describe("respiro (s) mantido em cada lado da fala"),
  }),
  zoom: z.object({
    perMinute: z.number().min(0).max(30).describe("zooms por minuto de vídeo"),
    scale: z.number().min(1).max(2),
    duration: z.number().min(0.5).max(10).describe("duração típica (s)"),
    focusY: z.number().min(0).max(1).describe("foco vertical (0 topo, 1 base)"),
  }),
  motion: z
    .array(
      z.object({
        component: z.string().describe("id de componente do catálogo"),
        when: z.string().max(200).describe("em que momento da fala usar"),
      }),
    )
    .max(8),
  pacing: z.string().max(400).describe("ritmo de cortes e energia do vídeo"),
  instructions: z
    .string()
    .max(4000)
    .describe("receita para o agente reproduzir o estilo em outro vídeo, em português, no imperativo"),
  /** Modelo pronto da casa: aplica também o acabamento determinístico e o orçamento de ritmo da skill. */
  skill: z.enum(["viral", "acao", "autoridade", "limpeza"]).optional(),
  /** Tratamento de cor, trilha, SFX e rampas do modelo (opcionais: modelos antigos não os têm). */
  look: z.object({ grade: z.enum(LOOK_IDS), vignette: z.number().min(0).max(1).default(0), letterbox: z.number().min(0).max(0.2).default(0) }).optional(),
  music: z.enum(MUSIC_MOODS).optional(),
  sfx: z.array(z.string().max(40)).max(12).optional(),
  speedRamps: z.boolean().optional(),
});
export type EditTemplate = z.infer<typeof EditTemplateSchema>;

/** Operações determinísticas do modelo: aplicadas no navegador, 0 créditos. */
export function templateOperations(template: EditTemplate, project: Project): OperationInput[] {
  // Modelo pronto: o acabamento completo da skill (cor, trilha, legenda, limpeza), já filtrado para este projeto.
  if (template.skill) return skillOperations(SKILLS[template.skill], project);
  const ops: OperationInput[] = [];
  const hasWords = timelineWords(project).length > 0;
  if (template.look) ops.push({ op: "set_look", look: template.look });
  if (template.music) ops.push({ op: "set_music", music: { mood: template.music, duck: true } });
  if (hasWords)
    ops.push({
      op: "set_captions",
      enabled: template.captions.enabled,
      style: { preset: template.captions.preset, position: template.captions.position },
    });
  return ops;
}

/** Pedido ao agente que reproduz a parte criativa do modelo (zooms, motion, cortes). */
export function templatePrompt(template: EditTemplate): string {
  const lines = [
    `Aplique o modelo de edição "${template.name}" a este vídeo.`,
    template.silence.remove
      ? `Pausas: remova silêncios acima de ${template.silence.minSilence}s mantendo ${template.silence.padding}s de respiro (remove_silences).`
      : "Pausas: o modelo mantém as pausas naturais; não use remove_silences.",
    template.zoom.perMinute > 0
      ? `Zooms: cerca de ${template.zoom.perMinute} por minuto, escala ${template.zoom.scale}, ~${template.zoom.duration}s cada, foco vertical ${template.zoom.focusY}, sempre em momentos de ênfase.`
      : "Zooms: o modelo não usa zoom.",
  ];
  if (template.look) lines.push(`Tratamento visual: ${template.look.grade}${template.look.vignette ? ", com vinheta" : ""}${template.look.letterbox ? " e barras cinemáticas" : ""} (já aplicado).`);
  if (template.music && template.music !== "none") lines.push(`Trilha: ${template.music}, com ducking sob a voz (já aplicada).`);
  if (template.sfx?.length) lines.push(`Efeitos sonoros do modelo (add_sfx, sincronizados com cortes e picos): ${template.sfx.join(", ")}.`);
  if (template.speedRamps) lines.push("Rampas de velocidade: câmera lenta (0.4–0.6x) nos ápices e aceleração (1.4–2.0x) nas transições, com speed_ramp.");
  if (template.motion.length)
    lines.push(
      "Motion design:",
      ...template.motion.map((m) => `- ${m.component}: ${m.when}`),
    );
  lines.push(
    `Ritmo: ${template.pacing}`,
    "",
    "Receita:",
    template.instructions,
    "",
    "Na resposta final, siga o formato de sempre: 1 a 3 frases, sem markdown.",
  );
  return lines.join("\n");
}

const WHEN: Record<string, string> = {
  depth_hook_title: "no gancho, nos 2 primeiros segundos, com a promessa em 1 a 3 palavras",
  stat_counter_card: "sempre que a fala citar um número forte",
  social_proof_toast: "quando citar um resultado, depoimento ou prova social",
  kinetic_pivot_card: "numa virada de raciocínio (problema → solução)",
  tactical_hud_overlay: "nos trechos de operação, com telemetria e status",
  callout_pointer: "para apontar um detalhe da cena",
  comparison_split: "para UM antes/depois ou mito/verdade",
  step_progress_bar: "quando a explicação tiver etapas ou capítulos",
  acronym_list: "ao enumerar os pontos de um diagnóstico ou estratégia",
};

/** Um modelo pronto como EditTemplate: o mesmo formato dos modelos extraídos de vídeos de exemplo. */
export function builtinTemplate(id: SkillId): EditTemplate {
  const s = SKILLS[id];
  const silence = s.local.find((o) => o.op === "remove_silences");
  const mode = silence?.op === "remove_silences" ? silence.mode : undefined;
  return EditTemplateSchema.parse({
    name: s.name,
    description: `${s.tagline}. ${s.audience}.`,
    captions: { enabled: s.recipe.captions !== null, preset: s.recipe.captions ?? "editorial_clean", position: "bottom" },
    silence: { remove: !!silence, minSilence: mode === "natural" ? 0.8 : mode === "dead" ? 1.5 : 0.45, padding: 0.15 },
    zoom: { perMinute: (s.pacing.zoomsPerMin[0] + s.pacing.zoomsPerMin[1]) / 2, scale: id === "viral" ? 1.08 : 1.15, duration: id === "viral" ? 2.5 : 4.5, focusY: 0.38 },
    motion: s.recipe.cards.map((component) => ({ component, when: WHEN[component] ?? "quando a fala pedir" })),
    pacing: s.tagline,
    instructions: s.direction,
    skill: id,
    look: (() => {
      const look = s.local.find((o) => o.op === "set_look");
      return look?.op === "set_look" ? { grade: look.look.grade ?? "none", vignette: look.look.vignette ?? 0, letterbox: look.look.letterbox ?? 0 } : undefined;
    })(),
    music: s.recipe.music,
    sfx: s.recipe.sfx,
    speedRamps: s.recipe.speedRamps,
  });
}

/** Os 3 modelos prontos da casa, visualmente distintos entre si. */
export const BUILTIN_TEMPLATES: { id: string; skill: SkillId; data: EditTemplate }[] = TEMPLATE_SKILLS.map((skill) => ({ id: `builtin_${skill}`, skill, data: builtinTemplate(skill) }));
