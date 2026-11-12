import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AgentOperationSchema,
  agentTier,
  applyOperations,
  auditPacing,
  buildAgentContext,
  creditCost,
  DEFAULT_PACING,
  enforcePacing,
  pacingReport,
  SKILLS,
  visualsReport,
  timelineWord,
  timelineWords,
  ProjectSchema,
  projectDuration,
  wordLines,
  wordsBetween,
  type OperationInput,
  type PacingProfile,
  type Project,
} from "@videoeditor/core";
import { catalogForAgent, validateComponent } from "@videoeditor/renderer";
import { agentModel, anthropicClient, anthropicError, fastAgentModel } from "@/server/ai";
import { anthropicCostUSD, assertCredits, balance, charge, recordUsage } from "@/server/billing";
import { decrypt, encrypt } from "@/server/crypto";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TURNS = 8;
/** Edição completa: plano, etapas de execução e as passagens de revisão. */
const MAX_TURNS_FULL = 16;
/** Quantas vezes o laudo de ritmo volta ao agente antes da poda determinística. */
const MAX_QA_PASSES = 2;
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
  /** Skill em uso: define o orçamento de ritmo que o auditor cobra. */
  skill: z.enum(["viral", "autoridade", "vsl", "limpeza"]).optional(),
  /** Quadros do vídeo (JPEG em base64) para o agente ver o enquadramento e o cenário. */
  frames: z
    .array(z.object({ t: z.number(), data: z.string().max(600_000).regex(/^[A-Za-z0-9+/=]+$/) }))
    .max(4)
    .default([]),
  /**
   * Revisão visual: capturas do vídeo JÁ editado (com textos e componentes na
   * tela), enviadas logo depois de uma edição completa. Só vale com o passe
   * que a própria edição devolveu, e não é cobrada.
   */
  review: z
    .object({
      token: z.string().max(600),
      shots: z.array(z.object({ t: z.number(), data: z.string().max(400_000).regex(/^[A-Za-z0-9+/=]+$/) })).min(1).max(8),
    })
    .optional(),
});

const REVIEW_MINUTES = 10;
const reviewToken = (userId: string) => encrypt(JSON.stringify({ u: userId, exp: Date.now() + REVIEW_MINUTES * 60_000 }));
function validReview(token: string, userId: string): boolean {
  try {
    const data = JSON.parse(decrypt(token)) as { u?: string; exp?: number };
    return data.u === userId && typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

// O agente só fala em ids de palavra e de clip: tempo de timeline não entra no vocabulário dele.
const ToolInputSchema = z.object({ operations: z.array(AgentOperationSchema).min(1) });

const EDIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "edit_timeline",
  description:
    "Aplica uma lista de operações de edição à timeline. A chamada é atômica: se qualquer operação falhar, nenhuma é aplicada e o erro é devolvido para você corrigir. O usuário vê o resultado de cada chamada na hora. Devolve um resumo do que mudou.",
  input_schema: z.toJSONSchema(ToolInputSchema, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
};

const PlanSchema = z.object({
  diagnostico: z
    .string()
    .max(900)
    .describe("O que este vídeo é e promete, para quem, e o que hoje o enfraquece (começo lento, repetição, trecho confuso, final sem fecho). Compare com um vídeo profissional do mesmo tipo. O usuário lê este texto: linguagem simples, sem ids de palavra, sem nomes de componentes e sem falar de tarja ou Brand Kit."),
  cortes: z.string().max(600).describe("O que sai da fala e por quê (takes ruins, aquecimento, repetição), citando as frases entre aspas, sem ids de palavra. 'nenhum' só se você conferiu a transcrição inteira."),
  capitulos: z
    .array(
      z.object({
        papel: z.enum(["gancho", "contexto", "desenvolvimento", "virada", "prova", "climax", "cta"]),
        fromWord: z.string().describe("primeira palavra do capítulo"),
        toWord: z.string().describe("última palavra do capítulo"),
        energia: z.enum(["alta", "media", "baixa"]).describe("alta: muitos estímulos; baixa: tela limpa, só câmera lenta"),
        tratamento: z.string().max(240).describe("o que acontece na tela neste capítulo e por quê, em linguagem de leigo (o usuário lê isto): 'título gigante', 'lista ao lado', 'número animado', 'cartão de tela cheia' — nunca ids ou nomes internos de componentes"),
        zooms: z.number().int().min(0).max(12),
        componentes: z.number().int().min(0).max(4),
      }),
    )
    .min(2)
    .max(12)
    .describe("Mapa de ritmo: o vídeo do início ao fim, em ordem, sem pular trechos."),
});

const PLAN_TOOL: Anthropic.Beta.BetaTool = {
  name: "plan_edit",
  description:
    "Registra o plano de edição do vídeo inteiro (diagnóstico + mapa de ritmo por capítulo) ANTES de qualquer edição. Devolve a duração de cada capítulo e a conferência do plano contra o orçamento de ritmo. Obrigatório como primeira chamada numa edição completa.",
  input_schema: z.toJSONSchema(PlanSchema, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
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

## Edição completa: assista, planeje, execute, revise
Quando o pedido é editar o vídeo inteiro (skill, modelo, "edite meu vídeo"), você trabalha como um editor profissional, nesta ordem:
1. Assista. Leia a transcrição inteira, os dados de voz e de enquadramento e os quadros do vídeo, antes de decidir qualquer coisa. Entenda o que o vídeo promete, para quem, e onde ele está fraco.
2. Planeje. Chame plan_edit com o diagnóstico e o mapa de ritmo: o vídeo dividido em capítulos (gancho, contexto, desenvolvimento, virada, prova, clímax, chamada para ação), cada um com a energia e o orçamento de zooms e componentes. Nenhuma edição é aceita antes do plano.
3. Execute em etapas, uma chamada de edit_timeline por etapa, subordinado ao plano: (a) fala — cortes; (b) câmera — zooms; (c) motion e legendas.
4. Revise. Cada edição devolve uma auditoria de ritmo. Tudo que vier em "Corrija" é obrigatório: resolva antes de responder. Se sobrar, a plataforma poda sozinha — e o resultado fica pior do que se você tivesse resolvido.

Um vídeo editado profissionalmente tem estas marcas, e o seu trabalho é entregá-las:
- Gancho tratado: nos primeiros 3 s acontece algo na tela junto com a primeira frase forte. Se o vídeo abre com aquecimento, corte até a primeira frase que promete algo.
- Ritmo variado e constante: sempre há um motivo visual para continuar olhando, mas nunca dois competindo. Capítulos de energia alta e baixa se alternam; depois de uma cena de tela cheia vem um respiro com o apresentador.
- Ênfase onde a voz enfatiza: use os dados de voz ("forte") para escolher as palavras que ganham punch-in ou destaque. Texto com cara de importante dito sem força não é ênfase.
- Hierarquia: uma ideia por vez na tela. O número mais forte, a virada e a conclusão ganham os recursos mais fortes; o resto ganha câmera.
- Fecho tratado: a conclusão ou chamada para ação nunca fica nua.
Editar pouco é um erro tão grave quanto editar demais. Entregar dois zooms num vídeo inteiro não é sobriedade: é não ter editado. O orçamento de ritmo que vem com o pedido tem mínimo e máximo, e os dois valem.

## Como trabalhar
- Baseie cada decisão na transcrição; não invente trechos que não estão nela.
- Pedidos pontuais (um ajuste, um trecho selecionado) não precisam de plano: resolva em uma chamada de edit_timeline.
- Câmera (add_zoom). Omita x e y: o zoom fecha sozinho no rosto medido no vídeo. Nunca empilhe dois zooms no mesmo instante:
  - punch-in seco: ease 0, scale 1.18–1.25, 2 a 4 s, na palavra dita com mais força ou numa troca de frase.
  - avanço lento: mode "creep", scale 1.12–1.18, 4 a 6 s, numa frase importante dita com calma. Abaixo de 1.1 ninguém percebe.
  - push-in suave: ease 0.4, scale 1.15–1.2, 3 a 5 s, numa conclusão.
  - pan lateral: scale 1.3 com panX ±0.12 e ease 0.35, para abrir espaço a um componente lateral. panX negativo leva o apresentador para a ESQUERDA e libera a direita; positivo, o contrário. O zoom deve cobrir todo o tempo do componente.
  - Alterne: depois de dois punch-ins, a próxima ênfase vai em tipografia, avanço lento ou pan.
- Motion design: escolha componentes do catálogo e preencha params com o que a pessoa realmente disse. Comece o componente na palavra em que o assunto é dito e sincronize os itens com atWord.
  - Nos textos, marque com *asteriscos* a palavra (uma ou duas) que carrega a emoção ou o ponto: ela sai em serifada itálica na cor de destaque. Não marque frases inteiras.
  - Cenas de tela cheia (kinetic_pivot_card, step_progress, stat_counter com fullscreen) cobrem o apresentador: use em viradas de raciocínio, com 4 a 6 s, e nunca duas seguidas.
  - acronym_list fica por cima do vídeo: ponha no lado mais livre do enquadramento e combine com um pan lateral para o lado oposto.
  - Use o enquadramento medido: nenhum texto por cima do rosto. Com pouca lateral livre, prefira a parte de baixo ou cenas de tela cheia.
  - depth_hook_title é só para o gancho, nos primeiros segundos.
- Mídia de contexto (add_broll): só existe o que o usuário enviou, listado em "Mídias de contexto". Use onde a fala trata do que a mídia mostra, por 2 a 5 s, e nunca sobre o gancho falado para a câmera nem junto com uma cena de tela cheia. layout "full" cobre o quadro; "card" deixa o apresentador visível. Conta como mudança visual no ritmo. Sem mídias listadas, não existe b-roll: não mencione.
- Formato: o contexto diz se o vídeo é vertical ou horizontal. No vertical há pouco espaço lateral: textos curtos.
- Marca: não passe cores nos params — os componentes herdam o Brand Kit do usuário. A tarja (executive_lower_third) usa o nome e a credencial do Brand Kit quando você omite os params. O contexto diz se ela está disponível; quando não está, siga sem ela e sem comentar — a falta da tarja nunca é motivo para editar menos.
- Legendas: a plataforma as esconde durante cenas de tela cheia e as desvia do texto dos outros componentes; não precisa desligá-las para evitar sobreposição.
- Efeitos sonoros são automáticos (saem dos zooms e componentes) e a plataforma já limita a frequência deles; você não os controla.
- Legendas: se a transcrição tem um erro evidente numa palavra que vai aparecer na tela (nome próprio, termo técnico, palavra trocada por outra parecida), corrija com edit_word. Só quando o contexto deixa a palavra certa clara.
- Se houver SELEÇÃO ATIVA, o pedido vale só para aquelas palavras: não altere nada fora delas.
- Se não houver transcrição neste trecho (vídeo sem fala), diga isso em vez de chutar.
- Se o pedido for ambíguo a ponto de arriscar estragar a edição, pergunte antes. Para ajustes de gosto, decida você e conte o que fez.

## Resposta final
Depois das edições, responda em português em NO MÁXIMO 3 frases curtas (até 400 caracteres), num único parágrafo de texto corrido: o que mudou no vídeo e por quê, com os números principais (tempo cortado, quantos destaques). O plano detalhado o usuário já viu; não o repita. É uma mensagem de chat para um leigo: sem listas, sem negrito, sem asteriscos, sem títulos; sem ids nem nomes internos de componentes; sem falar da auditoria, do plano, do Brand Kit, da tarja ou de ferramentas; e sem listar o que você decidiu não fazer nem o que deu trabalho.

## Catálogo de componentes de motion design
${catalogForAgent()}`;

/** Eventos enviados ao navegador, um JSON por linha, enquanto o agente trabalha. */
type AgentEvent =
  | { type: "status"; text: string }
  | { type: "plan"; plan: z.infer<typeof PlanSchema> }
  | { type: "ops"; project: Project; log: string[] }
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number; reviewToken?: string }
  | { type: "error"; error: string };

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Requisição inválida.");
    const { project, selection, message, history, skill, frames, review } = parsed.data;
    if (review && !validReview(review.token, user.id)) throw new HttpError(403, "A revisão visual expirou.");
    // Pedido pontual vai para o modelo rápido; direção do vídeo inteiro, para o principal.
    // A mesma classificação roda no navegador, então o preço mostrado é o cobrado.
    const tier = agentTier(message, !!selection);
    // A revisão visual faz parte da edição completa que a originou: não tem preço próprio.
    const price = review ? 0 : creditCost({ type: "agent", tier, durationSec: projectDuration(project) });
    if (!review) await assertCredits(user.id, price);
    const client = await anthropicClient();
    const model = tier === "full" || review ? await agentModel() : await fastAgentModel();
    const available = await balance(user.id);

    const full = tier === "full" && !review;
    // Só JPEG de verdade segue para o modelo: um quadro corrompido derrubaria o pedido inteiro.
    const stills = frames.filter((f) => f.data.startsWith("/9j/") && f.data.length > 2000);
    const profile: PacingProfile = skill ? SKILLS[skill].pacing : DEFAULT_PACING;
    let working = project;
    let planned = !full;
    let qaPasses = 0;
    const log: string[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const reviewShots = (review?.shots ?? []).filter((f) => f.data.startsWith("/9j/") && f.data.length > 2000);
    const messages: Anthropic.Beta.BetaMessageParam[] = review
      ? [
          {
            role: "user",
            content: [
              ...reviewShots.flatMap((f): Anthropic.Beta.BetaContentBlockParam[] => [
                { type: "text", text: `Quadro do vídeo EDITADO em ${f.t}s da timeline:` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
              ]),
              { type: "text", text: `<timeline>\n${buildAgentContext(project, null)}\n</timeline>\n\n${visualsReport(project)}\n\n${REVIEW_REQUEST}` },
            ],
          },
        ]
      : [
      ...history.map((h) => ({ role: h.role, content: h.text })),
      {
        role: "user",
        content: [
          // Quadros reais do vídeo: o agente vê o enquadramento, o cenário e o apresentador.
          ...(full
            ? stills.flatMap((f): Anthropic.Beta.BetaContentBlockParam[] => [
                { type: "text", text: `Quadro do vídeo bruto em ${f.t}s:` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
              ])
            : []),
          {
            type: "text",
            text: `<timeline>\n${buildAgentContext(project, selection)}\n</timeline>\n\n${full ? `<orcamento_de_ritmo>\n${budgetText(profile, projectDuration(project))}\n</orcamento_de_ritmo>\n\n` : ""}<pedido>\n${message}\n</pedido>`,
          },
        ],
      },
    ];

    /** Registra o custo real e cobra os créditos. Só cobra quando a timeline realmente mudou. */
    const settle = async () => {
      // Administradores não consomem créditos: o custo real é registrado, o débito é zero.
      const credits = log.length && user.role !== "admin" ? price : 0;
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
          // Raciocínio estendido só na edição completa; o ajuste pontual responde direto.
          ...(full ? { thinking: { type: "adaptive" as const }, output_config: { effort: "high" as const } } : review ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } } : {}),
          tools: full ? [READ_WORDS_TOOL, PLAN_TOOL, EDIT_TOOL] : [READ_WORDS_TOOL, EDIT_TOOL],
          messages,
          ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        // Se o usuário fechar a aba, a chamada ao modelo é cancelada e para de custar.
        { signal: req.signal },
      );
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use")
          send({
            type: "status",
            text:
              ev.content_block.name === "read_words"
                ? "Conferindo a transcrição…"
                : ev.content_block.name === "plan_edit"
                  ? "Planejando o ritmo do vídeo…"
                  : qaPasses
                    ? "Revisando o ritmo da edição…"
                    : log.length
                      ? "Aplicando a próxima etapa…"
                      : "Montando a edição…",
          });
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
      send({ type: "status", text: review ? "Conferindo os quadros do vídeo editado…" : full ? "Assistindo ao vídeo inteiro…" : "Lendo a transcrição…" });
      const maxTurns = full ? MAX_TURNS_FULL : MAX_TURNS;
      for (let turn = 0; turn < maxTurns; turn++) {
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
        if (response.stop_reason !== "tool_use") {
          // Loop de crítica: a edição pronta é auditada e o laudo volta ao agente antes de responder ao usuário.
          const audit = full && log.length ? auditPacing(working, profile) : null;
          if (audit?.issues.some((i) => i.severity === "erro") && qaPasses < MAX_QA_PASSES && turn < maxTurns - 1) {
            qaPasses++;
            send({ type: "status", text: "Revisando o ritmo da edição…" });
            messages.push({ role: "assistant", content: response.content });
            messages.push({
              role: "user",
              content: `Revisão de qualidade antes da entrega. A edição ainda não está no padrão:\n\n${visualsReport(working)}\n\n${pacingReport(audit)}\n\nCorrija com edit_timeline (os ids de clip estão no laudo e nos resultados anteriores) e só então dê a resposta final.`,
            });
            continue;
          }
          break;
        }

        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const fail = (content: string) => results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content });
          if (block.name === "read_words") {
            results.push(readWords(working, block.id, block.input));
            continue;
          }
          if (block.name === "plan_edit") {
            const plan = PlanSchema.safeParse(block.input);
            if (!plan.success) {
              fail(`Plano inválido: ${z.prettifyError(plan.error)}`);
              continue;
            }
            try {
              const review = reviewPlan(working, plan.data, profile);
              planned = true;
              send({ type: "plan", plan: plan.data });
              results.push({ type: "tool_result", tool_use_id: block.id, content: review });
            } catch (e) {
              fail(`${(e as Error).message}\nCorrija os ids e envie o plano de novo.`);
            }
            continue;
          }
          if (!planned) {
            fail("Edição completa exige o plano primeiro: chame plan_edit com o diagnóstico e o mapa de ritmo do vídeo inteiro, depois edite.");
            continue;
          }
          const input = ToolInputSchema.safeParse(block.input);
          if (!input.success) {
            fail(`Entrada inválida: ${z.prettifyError(input.error)}`);
            continue;
          }
          const ops = input.data.operations as OperationInput[];
          try {
            const result = applyOperations(working, ops, { validateComponent });
            working = result.project;
            log.push(...result.log);
            // A timeline do usuário é atualizada agora, sem esperar o agente terminar.
            send({ type: "ops", project: working, log: result.log });
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Aplicado:\n${result.log.map((l) => `- ${l}`).join("\n")}\nDuração atual: ${projectDuration(working)}s. Os ids de palavra continuam os mesmos.${full ? `\n\n${visualsReport(working)}\n\n${pacingReport(auditPacing(working, profile))}` : ""}`,
            });
          } catch (e) {
            fail(`${(e as Error).message}\nNenhuma operação desta chamada foi aplicada. Corrija e envie a lista completa de novo.`);
          }
        }
        messages.push({ role: "user", content: results });
      }
      // O que ainda colide depois da revisão é podado de forma determinística.
      if (full && log.length) {
        const pruned = enforcePacing(working, profile);
        if (pruned.log.length) {
          working = pruned.project;
          log.push(...pruned.log);
          send({ type: "ops", project: working, log: pruned.log });
        }
      }
      const bill = await settle();
      send({ type: "done", ...(full && log.length ? { reviewToken: reviewToken(user.id) } : {}), message: plainMessage(finalText) || (log.length ? "Edição aplicada." : "Não fiz alterações."), project: working, log, ...bill });
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

const REVIEW_REQUEST = `<pedido>
Revisão visual da edição que acabou de ser montada. Os quadros acima são o vídeo como o espectador vai ver, no celular, com os componentes e as legendas na tela. Olhe cada um como um editor exigente e procure só defeitos reais:
- texto difícil de ler: letra fina ou pequena demais, pouco contraste com o fundo, texto longo que encolheu;
- texto cortado na borda, quebrado de forma estranha ou saindo da área útil;
- texto ou cartão por cima do rosto do apresentador;
- dois elementos disputando o mesmo espaço (componente sobre componente, legenda sobre componente);
- palavra errada, repetida ou sem sentido num componente.
Para cada defeito, corrija com edit_timeline: encurte o texto (update_clip com params), tire o destaque de palavras demais, troque o lado da lista, encurte ou remova o componente (delete_clip). Não acrescente elementos novos e não mexa no que está bom.
Se não houver defeito, não chame nenhuma ferramenta e responda apenas: ok.
Se corrigiu algo, responda em uma frase, em texto corrido, o que ajustou.
</pedido>`;

/** A resposta vai para um balão de chat sem markdown: tira a marcação que escapar. */
function plainMessage(raw: string): string {
  let text = raw.replace(/\s*\n+\s*/g, " ");
  // Balão de chat: se o modelo se alongar, ficam as primeiras frases que cabem.
  if (text.length > 520) {
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
    let kept = "";
    for (const s of sentences) {
      if (kept && (kept + s).length > 480) break;
      kept += s;
    }
    text = kept;
  }
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Orçamento de ritmo em números absolutos para este vídeo. */
function budgetText(p: PacingProfile, duration: number): string {
  const minutes = Math.max(duration / 60, 0.25);
  const range = ([min, max]: [number, number]) => `${Math.floor(min * minutes)} a ${Math.max(1, Math.ceil(max * minutes))}`;
  return [
    `Vídeo de ${Math.round(duration)}s (antes dos seus cortes). O auditor de ritmo cobra estes limites, mínimo e máximo:`,
    `- zooms: ${range(p.zoomsPerMin)} no vídeo; escala mínima ${p.minZoomScale}x; no máximo ${p.maxPunchStreak} punch-ins secos seguidos.`,
    `- componentes de motion: ${range(p.componentsPerMin)} no vídeo; pelo menos ${p.componentGap}s entre o início de dois; ${p.fullscreenGap}s de respiro entre cenas de tela cheia.`,
    `- nunca mais de ${p.maxStatic}s sem zoom nem componente na tela, e nunca mais de ${p.maxPer5s} entradas visuais em 5s.`,
    ...(p.edges ? [`- gancho (0–3s) e fecho sempre tratados${p.captions ? "; legendas ligadas" : ""}.`] : []),
  ].join("\n");
}

/** Confere o plano contra a transcrição e o orçamento; o que volta guia a execução. */
function reviewPlan(project: Project, plan: z.infer<typeof PlanSchema>, profile: PacingProfile): string {
  const words = timelineWords(project);
  const duration = projectDuration(project);
  const minutes = Math.max(duration / 60, 0.25);
  const lines = ["Plano registrado. Capítulos na timeline atual:"];
  let zooms = 0;
  let components = 0;
  let prevEnd = 0;
  const notes: string[] = [];
  plan.capitulos.forEach((c, i) => {
    const a = timelineWord(project, c.fromWord, words);
    const b = timelineWord(project, c.toWord, words);
    const len = Math.round((b.end - a.start) * 10) / 10;
    zooms += c.zooms;
    components += c.componentes;
    lines.push(`${i + 1}. ${c.papel} [${c.fromWord}–${c.toWord}] ${a.start}–${b.end}s (${len}s), energia ${c.energia}: ${c.zooms} zoom(s), ${c.componentes} componente(s)`);
    if (i === 0 && c.papel !== "gancho") notes.push("O primeiro capítulo deve ser o gancho.");
    if (a.start - prevEnd > 3) notes.push(`Há ${Math.round(a.start - prevEnd)}s de vídeo sem capítulo antes de ${c.fromWord}: o plano precisa cobrir o vídeo inteiro (ou diga em "cortes" que esse trecho sai).`);
    if (c.componentes && len / c.componentes < profile.componentGap) notes.push(`Capítulo ${i + 1}: ${c.componentes} componentes em ${len}s não cabem (mínimo ${profile.componentGap}s entre eles).`);
    if (len > profile.maxStatic && c.zooms + c.componentes === 0) notes.push(`Capítulo ${i + 1}: ${len}s sem nada na tela passa do limite de ${profile.maxStatic}s.`);
    prevEnd = b.end;
  });
  if (duration - prevEnd > 3) notes.push(`Os últimos ${Math.round(duration - prevEnd)}s não estão em nenhum capítulo.`);
  const check = (n: number, [min, max]: [number, number], what: string) => {
    const lo = Math.floor(min * minutes);
    const hi = Math.max(1, Math.ceil(max * minutes));
    if (n < lo || n > hi) notes.push(`O plano soma ${n} ${what}; o orçamento deste vídeo é de ${lo} a ${hi}. Ajuste na execução.`);
  };
  check(zooms, profile.zoomsPerMin, "zooms");
  check(components, profile.componentsPerMin, "componentes");
  lines.push(`Total planejado: ${zooms} zooms, ${components} componentes.`);
  if (notes.length) lines.push("", "Ajustes necessários no plano (aplique na execução, sem reenviar o plano):", ...notes.map((n) => `- ${n}`));
  lines.push("", "Agora execute em etapas com edit_timeline: (a) cortes da fala, (b) câmera, (c) motion e legendas. Cada etapa devolve a auditoria de ritmo.");
  return lines.join("\n");
}
