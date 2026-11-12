import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AgentOperationSchema,
  applyOperations,
  buildAgentContext,
  creditCost,
  PRICING,
  ProjectSchema,
  projectDuration,
  wordLines,
  wordsBetween,
  type OperationInput,
  type Project,
} from "@videoeditor/core";
import { catalogForAgent, validateComponent } from "@videoeditor/renderer";
import { agentModel, anthropicClient, anthropicError } from "@/server/ai";
import { anthropicCostUSD, assertCredits, balance, charge, recordUsage } from "@/server/billing";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TURNS = 8;
/** Máximo de palavras por leitura: mantém o contexto enxuto em vídeos longos. */
const MAX_WORDS_WINDOW = 160;
/** Modelos que aceitam fallback de recusa no servidor. */
const supportsFallback = (model: string) => /^claude-(sonnet-5-5|opus-5|fable-5-[12])/.test(model);

const RequestSchema = z.object({
  project: ProjectSchema,
  selection: z.object({ start: z.number(), end: z.number() }).nullish(),
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(20)
    .default([]),
});

// O agente só fala em ids de palavra e de clip: tempo de timeline não entra no vocabulário dele.
const ToolInputSchema = z.object({ operations: z.array(AgentOperationSchema).min(1) });

const EDIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "edit_timeline",
  description:
    "Aplica uma lista de operações de edição à timeline. A chamada é atômica: se qualquer operação falhar, nenhuma é aplicada e o erro é devolvido para você corrigir. O usuário vê o resultado de cada chamada na hora. Devolve um resumo do que mudou.",
  input_schema: z.toJSONSchema(ToolInputSchema, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
};

const ReadWordsSchema = z.object({
  fromWord: z.string().describe("id da primeira palavra"),
  toWord: z.string().describe(`id da última palavra; até ${MAX_WORDS_WINDOW} palavras por leitura`),
});

const READ_WORDS_TOOL: Anthropic.Beta.BetaTool = {
  name: "read_words",
  description:
    "Lê a transcrição palavra por palavra (id | tempo no vídeo bruto | palavra) entre dois ids, já sem o que foi cortado. Use quando precisar do id exato de uma palavra no meio de uma frase. Não altera nada.",
  input_schema: z.toJSONSchema(ReadWordsSchema, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
};

// Prefixo estável (instruções + catálogo) → fica em cache entre requisições.
const SYSTEM = `Você é o diretor de edição de um editor de vídeo web para vídeo falado (Reels, Shorts, VSLs, aulas de especialistas). O usuário descreve o que quer em português e você edita a timeline dele.

Você nunca toca em pixels nem escreve código de animação: você altera o estado da timeline chamando edit_timeline com operações. O navegador do usuário renderiza o resultado na hora.

## Referências: sempre por palavra
- Cada palavra da transcrição tem um id (w0, w1, …) e um tempo no vídeo BRUTO. Esses valores nunca mudam, nem depois de cortes.
- Todas as operações usam ids de palavra (ou de clip). Você não calcula tempo de timeline e não precisa reler nada depois de cortar: uma âncora continua valendo. A ordem das operações não importa.
- Cortes: cut_words com {from, to} (inclusive). O corte cai sozinho no intervalo entre palavras.
- Zooms e componentes: atWord (onde começam) e untilWord ou duration (segundos). Itens internos de um componente que aceitam \`at\` recebem \`atWord\` com o id da palavra em que devem entrar.
- Não ancore nada em uma palavra que você está cortando.

## Prioridade nº 1: erros de gravação
Antes de qualquer efeito, limpe a fala. Um vídeo com um take errado no meio está estragado, por melhor que seja o resto.
- A seção "Takes ruins detectados" traz os candidatos com o corte pronto. Confiança alta: corte. Confiança media: leia o trecho e corte só se for erro (frase abandonada, tropeço, recomeço); repetição retórica fica.
- Procure também o que o detector não vê: a mesma ideia dita duas vezes com outras palavras (fica a última versão completa), frases que param no meio, falas para a equipe ou para si ("deixa eu ver", "tá gravando?"), e avisos de erro.
- Ao cortar um take ruim, corte-o inteiro: do início da frase errada até a palavra anterior ao take bom.
- remove_retakes corta de uma vez os de confiança alta; remove_silences tira as pausas. Os dois são determinísticos.

## Como trabalhar
- Baseie cada decisão na transcrição; não invente trechos que não estão nela.
- Trabalhe em etapas, uma chamada de edit_timeline por etapa, para o usuário ver a edição sendo montada: (1) limpeza — takes ruins e silêncios; (2) câmera — zooms; (3) motion e legendas. Pule as etapas que o pedido não pede. Pedidos pequenos cabem em uma chamada só.
- Zooms: nos momentos de ênfase, 2 a 5 segundos, escala entre 1.1 e 1.4. Em vídeo de pessoa falando, o foco é o rosto (y≈0.35–0.4). ease 0 é punch-in seco; ease alto é aproximação lenta. Não empilhe zooms no mesmo instante.
- Motion design: escolha componentes do catálogo e preencha params com o que a pessoa realmente disse. Comece o componente na palavra em que o assunto é dito.
- Marca: não passe cores nos params — os componentes herdam o Brand Kit do usuário. A tarja de nome (lower_third) usa o nome e a credencial do Brand Kit quando você omite title/subtitle; se o Brand Kit não tem apresentador e o usuário não disse o nome, não invente: não use a tarja e avise.
- Cada componente de motion custa créditos ao usuário: use os que fazem diferença, não encha o vídeo.
- Legendas: se a transcrição tem um erro evidente numa palavra que vai aparecer na tela (nome próprio, termo técnico, palavra trocada por outra parecida), corrija com edit_word. Só quando o contexto deixa a palavra certa clara.
- Se houver SELEÇÃO ATIVA, o pedido vale só para aquelas palavras: não altere nada fora delas.
- Se o pedido depender de transcrição e ela não existir, explique que é preciso transcrever o vídeo primeiro (botão "Transcrever") em vez de chutar.
- Se o pedido for ambíguo a ponto de arriscar estragar a edição, pergunte antes. Para ajustes de gosto, decida você e conte o que fez.

## Resposta final
Depois das edições, responda em português, em 1 a 3 frases curtas e num parágrafo só, dizendo o que mudou (quantos cortes, quanto tempo saiu, o que foi adicionado). Sem markdown, sem ids internos.

## Catálogo de componentes de motion design
${catalogForAgent()}`;

/** Eventos enviados ao navegador, um JSON por linha, enquanto o agente trabalha. */
type AgentEvent =
  | { type: "status"; text: string }
  | { type: "ops"; project: Project; log: string[] }
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number }
  | { type: "error"; error: string };

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Requisição inválida.");
    const { project, selection, message, history } = parsed.data;
    // Mínimo para começar; cenas de motion são conferidas antes de cada inserção.
    await assertCredits(user.id, PRICING.agentEdit);
    const client = await anthropicClient();
    const model = await agentModel();
    const available = await balance(user.id);

    let working = project;
    const log: string[] = [];
    let motionScenes = 0;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.map((h) => ({ role: h.role, content: h.text })),
      {
        role: "user",
        content: `<timeline>\n${buildAgentContext(project, selection)}\n</timeline>\n\n<pedido>\n${message}\n</pedido>`,
      },
    ];

    /** Registra o custo real e cobra os créditos. Só cobra quando a timeline realmente mudou. */
    const settle = async () => {
      const credits = log.length ? creditCost({ type: "agent", motionScenes }) : 0;
      if (usage.input || usage.output)
        await recordUsage({ userId: user.id, kind: "agent", provider: "anthropic", model, tokens: usage, costUSD: anthropicCostUSD(model, usage), credits });
      return { credits, balance: credits ? await charge(user.id, credits, "pedido ao agente") : available };
    };

    /** Um turno do modelo, em streaming: avisa o navegador assim que uma ferramenta começa a ser usada. */
    const runTurn = async (send: (e: AgentEvent) => void) => {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 16000,
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          thinking: { type: "adaptive" },
          output_config: { effort: "medium" },
          tools: [READ_WORDS_TOOL, EDIT_TOOL],
          messages,
          ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        // Se o usuário fechar a aba, a chamada ao modelo é cancelada e para de custar.
        { signal: req.signal },
      );
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use")
          send({ type: "status", text: ev.content_block.name === "read_words" ? "Conferindo a transcrição…" : log.length ? "Aplicando a próxima etapa…" : "Montando a edição…" });
      });
      const response = await stream.finalMessage();
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
      return response;
    };

    const run = async (send: (e: AgentEvent) => void) => {
      let finalText = "";
      send({ type: "status", text: "Lendo a transcrição…" });
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await runTurn(send);
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
          const fail = (content: string) => results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content });
          if (block.name === "read_words") {
            results.push(readWords(working, block.id, block.input));
            continue;
          }
          const input = ToolInputSchema.safeParse(block.input);
          if (!input.success) {
            fail(`Entrada inválida: ${z.prettifyError(input.error)}`);
            continue;
          }
          const ops = input.data.operations as OperationInput[];
          const scenes = ops.filter((o) => o.op === "add_component").length;
          const cost = creditCost({ type: "agent", motionScenes: motionScenes + scenes });
          if (scenes && cost > available) {
            fail(
              `Créditos insuficientes: com ${motionScenes + scenes} cena(s) de motion o pedido custaria ${cost} créditos e o usuário tem ${available}. Nada desta chamada foi aplicado. Reduza as cenas de motion (cada uma custa ${PRICING.motionScene}) ou faça só os cortes e zooms, e conte isso ao usuário.`,
            );
            continue;
          }
          try {
            const result = applyOperations(working, ops, { validateComponent });
            working = result.project;
            log.push(...result.log);
            motionScenes += scenes;
            // A timeline do usuário é atualizada agora, sem esperar o agente terminar.
            send({ type: "ops", project: working, log: result.log });
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Aplicado:\n${result.log.map((l) => `- ${l}`).join("\n")}\nDuração atual: ${projectDuration(working)}s. Os ids de palavra continuam os mesmos.`,
            });
          } catch (e) {
            fail(`${(e as Error).message}\nNenhuma operação desta chamada foi aplicada. Corrija e envie a lista completa de novo.`);
          }
        }
        messages.push({ role: "user", content: results });
      }
      const bill = await settle();
      send({ type: "done", message: finalText || (log.length ? "Edição aplicada." : "Não fiz alterações."), project: working, log, ...bill });
    };

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (e: AgentEvent) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
          } catch {
            // navegador desconectou: nada a enviar
          }
        };
        try {
          await run(send);
        } catch (e) {
          // O que já foi gasto e entregue antes da falha é registrado e cobrado.
          await settle().catch((err) => console.error("agent: falha ao registrar uso", err));
          const known = anthropicError(e) ?? e;
          if (!(known instanceof HttpError) && !req.signal.aborted) console.error(known);
          send({ type: "error", error: known instanceof HttpError ? known.message : "Erro inesperado no servidor." });
        } finally {
          try {
            controller.close();
          } catch {
            // já fechado
          }
        }
      },
    });
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function readWords(project: Project, toolUseId: string, raw: unknown): Anthropic.Beta.BetaToolResultBlockParam {
  const input = ReadWordsSchema.safeParse(raw);
  if (!input.success)
    return { type: "tool_result", tool_use_id: toolUseId, is_error: true, content: z.prettifyError(input.error) };
  try {
    const words = wordsBetween(project, input.data.fromWord, input.data.toWord, MAX_WORDS_WINDOW);
    return { type: "tool_result", tool_use_id: toolUseId, content: wordLines(project, words).join("\n") };
  } catch (e) {
    return { type: "tool_result", tool_use_id: toolUseId, is_error: true, content: (e as Error).message };
  }
}
