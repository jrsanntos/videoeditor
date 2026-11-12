import { z } from "zod";
import type { OperationInput } from "./ops";
import type { Project } from "./schema";
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
    preset: z.enum(["karaoke", "bold", "clean"]),
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
    .max(2000)
    .describe("receita para o agente reproduzir o estilo em outro vídeo, em português, no imperativo"),
});
export type EditTemplate = z.infer<typeof EditTemplateSchema>;

/** Operações determinísticas do modelo: aplicadas no navegador, 0 créditos. */
export function templateOperations(template: EditTemplate, project: Project): OperationInput[] {
  const ops: OperationInput[] = [];
  const hasWords = timelineWords(project).length > 0;
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
