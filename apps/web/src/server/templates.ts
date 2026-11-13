import "server-only";
import crypto from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { BUILTIN_TEMPLATES, CAPTION_PRESET_IDS, EditTemplateSchema, type EditTemplate, type Transcript } from "@videoeditor/core";
import { catalogForAgent, COMPONENTS } from "@videoeditor/renderer";
import { db } from "./db";
import { agentModel, anthropicClient, anthropicError, transcribeAudio } from "./ai";
import { anthropicCostUSD, groqCostUSD, recordUsage } from "./billing";
import { HttpError } from "./errors";

export type TemplateRecord = {
  id: string;
  status: "draft" | "published";
  data: EditTemplate;
  sourceName: string;
  sourceDuration: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  status: "draft" | "published";
  data: EditTemplate;
  source_name: string;
  source_duration: number;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
};

const toRecord = (r: Row): TemplateRecord => ({
  id: r.id,
  status: r.status,
  data: r.data,
  sourceName: r.source_name,
  sourceDuration: r.source_duration,
  thumbnail: r.thumbnail,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listTemplates(opts: { publishedOnly?: boolean } = {}): Promise<TemplateRecord[]> {
  const rows = await db.query<Row>(
    `SELECT * FROM templates ${opts.publishedOnly ? "WHERE status = 'published'" : ""} ORDER BY updated_at DESC`,
  );
  return rows.map(toRecord);
}

export async function getTemplate(id: string): Promise<TemplateRecord | null> {
  const row = await db.one<Row>("SELECT * FROM templates WHERE id = $1", [id]);
  return row ? toRecord(row) : null;
}

export async function updateTemplate(id: string, patch: { status?: "draft" | "published"; data?: EditTemplate }) {
  const current = await getTemplate(id);
  if (!current) throw new HttpError(404, "Modelo não encontrado.");
  const data = patch.data ? EditTemplateSchema.parse(sanitize(patch.data)) : current.data;
  await db.run("UPDATE templates SET status = $2, data = $3, updated_at = now() WHERE id = $1", [
    id,
    patch.status ?? current.status,
    JSON.stringify(data),
  ]);
  return (await getTemplate(id))!;
}

export async function deleteTemplate(id: string) {
  await db.run("DELETE FROM templates WHERE id = $1", [id]);
}

/** Os 3 modelos prontos da casa, no mesmo formato dos extraídos: sempre disponíveis, sem depender do banco. */
export function builtinTemplates(): TemplateRecord[] {
  return BUILTIN_TEMPLATES.map((t) => ({ id: t.id, status: "published" as const, data: t.data, sourceName: "modelo da casa", sourceDuration: 0, thumbnail: null, createdAt: "", updatedAt: "" }));
}

/** Remove componentes que não existem no catálogo (o modelo nunca pode quebrar o editor). */
function sanitize(t: EditTemplate): EditTemplate {
  return { ...t, motion: t.motion.filter((m) => m.component in COMPONENTS) };
}

// ---------- Extração a partir de um vídeo de exemplo ----------

/**
 * Formato pedido ao modelo: o mesmo do EditTemplate, sem limites numéricos
 * (structured outputs não os impõe); os limites são aplicados depois.
 */
const ExtractionSchema = z.object({
  name: z.string(),
  description: z.string(),
  captions: z.object({
    enabled: z.boolean(),
    preset: z.enum(CAPTION_PRESET_IDS),
    position: z.enum(["bottom", "center", "top"]),
  }),
  silence: z.object({ remove: z.boolean(), minSilence: z.number(), padding: z.number() }),
  zoom: z.object({ perMinute: z.number(), scale: z.number(), duration: z.number(), focusY: z.number() }),
  motion: z.array(z.object({ component: z.string(), when: z.string() })),
  pacing: z.string(),
  instructions: z.string(),
});

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function normalize(x: z.infer<typeof ExtractionSchema>): EditTemplate {
  return EditTemplateSchema.parse(
    sanitize({
      name: cut(x.name.trim() || "Modelo sem nome", 60),
      description: cut(x.description, 280),
      captions: x.captions,
      silence: {
        remove: x.silence.remove,
        minSilence: clamp(x.silence.minSilence, 0.15, 3),
        padding: clamp(x.silence.padding, 0, 0.5),
      },
      zoom: {
        perMinute: clamp(x.zoom.perMinute, 0, 30),
        scale: clamp(x.zoom.scale, 1, 2),
        duration: clamp(x.zoom.duration, 0.5, 10),
        focusY: clamp(x.zoom.focusY, 0, 1),
      },
      motion: x.motion.slice(0, 8).map((m) => ({ component: m.component, when: cut(m.when, 200) })),
      pacing: cut(x.pacing, 400),
      instructions: cut(x.instructions, 2000),
    }),
  );
}

const EXTRACTION_SYSTEM = `Você analisa vídeos de exemplo, já editados, de um editor de vídeo web voltado a vídeo falado (VSLs, aulas, especialistas), e extrai o ESTILO DE EDIÇÃO como um modelo reutilizável. Outros usuários vão aplicar esse modelo nos próprios vídeos brutos, então descreva decisões de edição transferíveis, não o conteúdo deste vídeo.

Você recebe quadros amostrados com o instante de cada um, a transcrição com tempos e medidas de pausas. A partir disso:
- Legendas: se aparecem queimadas nos quadros, escolha o preset mais parecido (viral_pop = 2–3 palavras grandes com a ativa em cor e maior; karaoke_pill = pílula colorida atrás da palavra falada; comic_bounce = contorno espesso e entrada elástica; editorial_clean = caixa escura discreta; neon_subtitle = brilho neon; minimal_cinema = legenda de cinema pequena; karaoke/bold/clean = os clássicos) e a posição. Se não há legendas, enabled = false.
- Pausas: um vídeo editado quase não tem pausas longas. Se as pausas medidas forem curtas e raras, remove = true, com minSilence e padding coerentes com o ritmo observado.
- Zooms: estime pela variação de enquadramento entre quadros próximos (rosto maior/menor). perMinute 0 se não houver.
- Motion design: só use componentes do catálogo abaixo e descreva em "when" o gatilho na fala (ex.: "quando citar números comparáveis"). Lista vazia se não houver gráficos/textos animados.
- instructions: receita em português, no imperativo, para o agente de edição reproduzir o estilo em outro vídeo (o que cortar, onde dar zoom, que componentes usar e quando, densidade). Seja concreto e não cite trechos deste vídeo.
- name: nome curto e descritivo do estilo (ex.: "VSL dinâmica com gráficos"). description: uma ou duas frases para o usuário final.

## Catálogo de componentes
${catalogForAgent()}`;

export type ExtractionInput = {
  sourceName: string;
  duration: number;
  width: number;
  height: number;
  audio: Blob;
  frames: { t: number; image: Blob }[];
  pauses: { count: number; total: number; longest: number };
};

export async function extractTemplate(input: ExtractionInput, actorId: string): Promise<TemplateRecord> {
  if (!input.frames.length) throw new HttpError(400, "Nenhum quadro do vídeo foi enviado.");
  const client = await anthropicClient();

  let transcript: Transcript | null = null;
  try {
    const t = await transcribeAudio(input.audio);
    transcript = t.transcript.words.length ? t.transcript : null;
    await recordUsage({
      userId: actorId,
      kind: "template_extract",
      provider: "groq",
      model: "whisper-large-v3-turbo",
      audioSeconds: t.seconds,
      costUSD: groqCostUSD(t.seconds),
      credits: 0,
    });
  } catch (e) {
    // Vídeo sem fala ainda gera modelo (só pelo visual); outros erros sobem.
    if (!(e instanceof HttpError && e.status === 422)) throw e;
  }

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Vídeo de exemplo: "${input.sourceName}" — ${input.width}x${input.height}, ${input.duration.toFixed(1)}s.\nPausas medidas no áudio (>0,4s): ${input.pauses.count}, somando ${input.pauses.total.toFixed(1)}s; a maior tem ${input.pauses.longest.toFixed(1)}s.\n\nQuadros amostrados:`,
    },
  ];
  for (const f of input.frames) {
    content.push({ type: "text", text: `Quadro em ${f.t.toFixed(1)}s:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(await f.image.arrayBuffer()).toString("base64") },
    });
  }
  content.push({
    type: "text",
    text: transcript
      ? `Transcrição (início–fim em segundos):\n${transcript.words.map((w) => `${w.start.toFixed(2)}–${w.end.toFixed(2)} ${w.text}`).join("\n")}`
      : "Transcrição: o vídeo não tem fala detectável.",
  });

  const model = await agentModel();
  let parsed: z.infer<typeof ExtractionSchema> | null;
  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(ExtractionSchema) },
      messages: [{ role: "user", content }],
    });
    const tokens = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    };
    await recordUsage({
      userId: actorId,
      kind: "template_extract",
      provider: "anthropic",
      model,
      tokens,
      costUSD: anthropicCostUSD(model, tokens),
      credits: 0,
    });
    if (response.stop_reason === "refusal") throw new HttpError(422, "A IA recusou analisar este vídeo.");
    parsed = response.parsed_output;
  } catch (e) {
    throw anthropicError(e) ?? e;
  }
  if (!parsed) throw new HttpError(502, "A IA não devolveu um modelo válido. Tente novamente.");

  const data = normalize(parsed);
  const mid = input.frames[Math.floor(input.frames.length / 2)]!;
  const thumbnail = `data:image/jpeg;base64,${Buffer.from(await mid.image.arrayBuffer()).toString("base64")}`;
  const id = `tpl_${crypto.randomUUID()}`;
  await db.run(
    `INSERT INTO templates (id, status, data, source_name, source_duration, thumbnail, created_by)
     VALUES ($1, 'draft', $2, $3, $4, $5, $6)`,
    [id, JSON.stringify(data), input.sourceName, input.duration, thumbnail, actorId],
  );
  return (await getTemplate(id))!;
}
