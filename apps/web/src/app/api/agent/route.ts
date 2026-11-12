import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  applyOperations,
  buildAgentContext,
  creditCost,
  OperationSchema,
  ProjectSchema,
  projectDuration,
  type OperationInput,
} from "@videoeditor/core";
import { catalogForAgent, validateComponent } from "@videoeditor/renderer";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.AGENT_MODEL || "claude-sonnet-5-5";
const MAX_TURNS = 5;
/** Modelos que aceitam fallback de recusa no servidor. */
const SUPPORTS_FALLBACK = /^claude-(sonnet-5-5|opus-5|fable-5-[12])/.test(MODEL);

const RequestSchema = z.object({
  project: ProjectSchema,
  selection: z.object({ start: z.number(), end: z.number() }).nullish(),
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(20)
    .default([]),
});

const ToolInputSchema = z.object({ operations: z.array(OperationSchema).min(1) });

const EDIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "edit_timeline",
  description:
    "Aplica uma lista de operações de edição à timeline, em ordem. A chamada é atômica: se qualquer operação falhar, nenhuma é aplicada e o erro é devolvido para você corrigir. Devolve um resumo do que mudou.",
  input_schema: z.toJSONSchema(ToolInputSchema, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
};

// Prefixo estável (instruções + catálogo) → fica em cache entre requisições.
const SYSTEM = `Você é o diretor de edição de um editor de vídeo web voltado a vídeo falado (VSLs, aulas, conteúdo de especialistas). O usuário descreve o que quer em português e você edita a timeline dele.

Você nunca toca em pixels nem escreve código de animação: você altera o estado da timeline chamando a ferramenta edit_timeline com operações. O navegador do usuário renderiza o resultado na hora.

## Como trabalhar
- Você recebe o estado atual da timeline e a transcrição com tempos em segundos (tempo de timeline). Baseie cada decisão nesses tempos; não invente trechos que não estão na transcrição.
- Faça tudo em UMA chamada de edit_timeline sempre que possível. As operações rodam em ordem e cada uma enxerga o resultado da anterior, então coloque primeiro o que usa os tempos que você leu (add_zoom, add_component) e deixe os cortes (remove_ranges, remove_silences) por ÚLTIMO: o ripple desloca zooms e componentes junto com a fala.
- Para tirar pausas, use remove_silences (determinístico). Para tirar erros, repetições ou trechos específicos, use remove_ranges com os tempos da transcrição, cortando no intervalo entre palavras para não comer sílabas.
- Zooms: use nos momentos de ênfase, 2 a 5 segundos, escala entre 1.15 e 1.4. Em vídeo de pessoa falando, o foco costuma ser o rosto (y≈0.35–0.4). Não empilhe zooms no mesmo instante.
- Motion design: escolha componentes do catálogo abaixo e preencha params com dados que a pessoa realmente disse. Sincronize o início com a fala correspondente. Se o pedido não couber em nenhum componente, diga isso em vez de improvisar.
- Se houver SELEÇÃO ATIVA, o pedido vale só para aquele trecho: não altere nada fora dele.
- Se o pedido depender de transcrição e ela não existir, explique que é preciso transcrever o vídeo primeiro (botão "Transcrever") em vez de chutar tempos.
- Se o pedido for ambíguo a ponto de arriscar estragar a edição, pergunte antes. Para ajustes de gosto, decida você e conte o que fez.

## Resposta final
Depois das edições, responda em português, em 1 a 3 frases, dizendo o que mudou (quantos cortes, quanto tempo saiu, o que foi adicionado e onde). Sem markdown, sem listar ids internos.

## Catálogo de componentes de motion design
${catalogForAgent()}`;

export async function POST(req: Request) {
  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Requisição inválida." }, { status: 400 });
  const { project, selection, message, history } = parsed.data;

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return noCredentials();
  }

  let working = project;
  const log: string[] = [];
  let motionScenes = 0;
  const usage = { input: 0, output: 0, cacheRead: 0 };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.text })),
    {
      role: "user",
      content: `<timeline>\n${buildAgentContext(project, selection)}\n</timeline>\n\n<pedido>\n${message}\n</pedido>`,
    },
  ];

  try {
    let finalText = "";
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools: [EDIT_TOOL],
        messages,
        ...(SUPPORTS_FALLBACK
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      });
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

      finalText = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (response.stop_reason === "refusal") {
        finalText = "Não posso ajudar com esse pedido. Tente descrever a edição de outra forma.";
        break;
      }
      if (response.stop_reason === "max_tokens") {
        finalText ||= "A resposta ficou longa demais e foi interrompida. Tente dividir o pedido em partes.";
        break;
      }
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = ToolInputSchema.safeParse(block.input);
        if (!input.success) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Entrada inválida: ${z.prettifyError(input.error)}`,
          });
          continue;
        }
        try {
          const ops = input.data.operations as OperationInput[];
          const result = applyOperations(working, ops, { validateComponent });
          working = result.project;
          log.push(...result.log);
          motionScenes += ops.filter((o) => o.op === "add_component").length;
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Aplicado:\n${result.log.map((l) => `- ${l}`).join("\n")}\nDuração atual: ${projectDuration(working)}s. Os tempos da transcrição que você recebeu não valem mais depois de cortes.`,
          });
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `${(e as Error).message}\nNenhuma operação desta chamada foi aplicada. Corrija e envie a lista completa de novo.`,
          });
        }
      }
      messages.push({ role: "user", content: results });
    }

    return Response.json({
      message: finalText || (log.length ? "Edição aplicada." : "Não fiz alterações."),
      project: working,
      log,
      // Só cobra quando a timeline realmente mudou.
      credits: log.length ? creditCost({ type: "agent", motionScenes }) : 0,
      usage,
      model: MODEL,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return noCredentials();
    if (e instanceof Anthropic.RateLimitError)
      return Response.json({ error: "Muitas requisições ao agente. Aguarde alguns segundos e tente de novo." }, { status: 429 });
    if (e instanceof Anthropic.APIError) {
      console.error("agent api error", e.status, e.message);
      return Response.json({ error: "O serviço de IA falhou ao processar o pedido. Tente novamente." }, { status: 502 });
    }
    if (e instanceof Error && /authentication|api.?key|credential/i.test(e.message)) return noCredentials();
    console.error("agent error", e);
    return Response.json({ error: "Erro inesperado no agente." }, { status: 500 });
  }
}

function noCredentials() {
  return Response.json(
    {
      error:
        "O agente de IA não está configurado neste servidor (defina ANTHROPIC_API_KEY em apps/web/.env.local). A edição manual e a remoção local de silêncios funcionam sem ele.",
    },
    { status: 503 },
  );
}
