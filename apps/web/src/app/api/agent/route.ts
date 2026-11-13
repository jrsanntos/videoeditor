import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  agentTier,
  applyOperations,
  auditPacing,
  buildAgentContext,
  creditCost,
  critiqueEdit,
  critiqueReport,
  DEFAULT_PACING,
  enforcePacing,
  mainClips,
  MAX_CRITIC_CYCLES,
  pacingReport,
  SKILLS,
  sourceRangesToTimeline,
  timelineView,
  visualsReport,
  timelineWord,
  timelineWords,
  ProjectSchema,
  projectDuration,
  wordLines,
  wordsBetween,
  type AgentTier,
  type OperationInput,
  type PacingProfile,
  type Project,
  type Skill,
} from "@videoeditor/core";
import { screenTexts, validateComponent, validateSfx } from "@videoeditor/renderer";
import { ACT_NAMES, AGENT_ROLES, agentModel, anthropicClient, anthropicError, fastAgentModel, MAX_WORDS_WINDOW, PlanSchema, ReadWordsSchema, ToolInputSchema, type AgentRole, type EditPlan } from "@/server/ai";
import { anthropicCostUSD, assertCredits, balance, charge, recordUsage } from "@/server/billing";
import { decrypt, encrypt } from "@/server/crypto";
import { unsealTier } from "@/server/tiers";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rota do agente, em três papéis (ver server/agents.ts):
 *
 *   phase "plan"     Diretor: devolve o plano por atos e um passe (planToken).
 *                    Nada é editado nem cobrado; o chat pede a confirmação.
 *   phase "execute"  Editor: executa o plano confirmado (planToken), com o
 *                    Crítico determinístico em até 3 ciclos de autocorreção.
 *   phase "auto"     Pedido pontual → Editor direto. Edição completa sem
 *                    confirmação (assistente de um clique) → Diretor e Editor em sequência.
 *   review           Crítico visual: tira de diagnóstico + quadros do vídeo editado.
 */
const MAX_TURNS = 8;
/** Edição completa: etapas de execução e as passagens de revisão. */
const MAX_TURNS_EDITOR = 18;
const MAX_TURNS_DIRECTOR = 5;
/** Passada no vídeo todo: uma tarefa, várias chamadas possíveis (vídeos longos). */
const MAX_TURNS_SWEEP = 12;
/** Modelos que aceitam fallback de recusa no servidor. */
const supportsFallback = (model: string) => /^claude-(sonnet-5-5|opus-5|fable-5-[12])/.test(model);

const image = z.string().max(700_000).regex(/^[A-Za-z0-9+/=]+$/);
const RequestSchema = z.object({
  project: ProjectSchema,
  selection: z.object({ start: z.number(), end: z.number() }).nullish(),
  message: z.string().min(1).max(6000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
    .max(20)
    .default([]),
  /** Modelo de edição em uso: define o orçamento de ritmo e o acabamento que o Crítico cobra. */
  skill: z.enum(["viral", "acao", "autoridade", "limpeza"]).optional(),
  phase: z.enum(["auto", "plan", "execute"]).default("auto"),
  /** Passe da classificação por intenção (/api/agent/tier): nível e preço mostrados antes do envio. */
  tierToken: z.string().max(2000).optional(),
  /** Passe devolvido pela fase "plan": o plano que o usuário confirmou. */
  planToken: z.string().max(12_000).optional(),
  /** Quadros do vídeo (JPEG em base64) para o agente ver o enquadramento e o cenário. */
  frames: z.array(z.object({ t: z.number(), data: image })).max(4).default([]),
  /**
   * Crítico visual: capturas do vídeo JÁ editado e a tira de diagnóstico,
   * enviadas depois de uma edição completa. Só vale com o passe que a própria
   * edição devolveu, não é cobrado, e o passe conta os ciclos (máximo 3).
   */
  review: z
    .object({
      token: z.string().max(600),
      shots: z.array(z.object({ t: z.number(), data: image })).min(1).max(8),
      strip: image.optional(),
    })
    .optional(),
});

const TOKEN_MINUTES = 30;
const seal = (data: Record<string, unknown>) => encrypt(JSON.stringify({ ...data, exp: Date.now() + TOKEN_MINUTES * 60_000 }));
function unseal<T>(token: string, userId: string, kind: string): T | null {
  try {
    const data = JSON.parse(decrypt(token)) as { u?: string; k?: string; exp?: number };
    return data.u === userId && data.k === kind && typeof data.exp === "number" && data.exp > Date.now() ? (data as T) : null;
  } catch {
    return null;
  }
}
const reviewToken = (userId: string, cycle: number, skill?: string) => seal({ u: userId, k: "review", n: cycle, s: skill });
const planToken = (userId: string, plan: EditPlan) => seal({ u: userId, k: "plan", plan });

/** Eventos enviados ao navegador, um JSON por linha, enquanto o agente trabalha. */
type AgentEvent =
  | { type: "status"; text: string; role?: AgentRole }
  | { type: "plan"; plan: EditPlan; planToken?: string }
  | { type: "ops"; project: Project; log: string[] }
  | { type: "done"; message: string; project: Project; log: string[]; credits: number; balance: number; reviewToken?: string; awaitingConfirmation?: boolean }
  | { type: "error"; error: string };

const jpegs = <T extends { data: string }>(list: T[]) => list.filter((f) => f.data.startsWith("/9j/") && f.data.length > 2000);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Requisição inválida.");
    const { project, selection, message, history, frames, review, phase } = parsed.data;
    const pass = review ? unseal<{ n: number; s?: string }>(review.token, user.id, "review") : null;
    if (review && (!pass || pass.n >= MAX_CRITIC_CYCLES)) throw new HttpError(403, "A revisão visual expirou.");
    const confirmed = parsed.data.planToken ? unseal<{ plan: EditPlan }>(parsed.data.planToken, user.id, "plan") : null;
    if (phase === "execute" && !confirmed) throw new HttpError(409, "O plano expirou. Peça a edição de novo.");
    const skillId = parsed.data.skill ?? (pass?.s as keyof typeof SKILLS | undefined);
    const skill: Skill | undefined = skillId && skillId in SKILLS ? SKILLS[skillId] : undefined;

    // Pedido pontual vai para o modelo rápido; passada no vídeo todo e direção completa, para o principal.
    // O nível vem do passe da classificação por intenção (o preço que o usuário viu); sem ele, da regra determinística.
    const tier: AgentTier = phase === "auto" ? (unsealTier(parsed.data.tierToken, user.id, message) ?? agentTier(message, !!selection)) : "full";
    // O plano e a revisão fazem parte da edição completa: quem tem preço é a execução.
    const price = review || phase === "plan" ? 0 : creditCost({ type: "agent", tier, durationSec: projectDuration(project) });
    if (!review) await assertCredits(user.id, phase === "plan" ? creditCost({ type: "agent", tier: "full", durationSec: projectDuration(project) }) : price);
    const client = await anthropicClient();
    const model = tier !== "adjust" || review ? await agentModel() : await fastAgentModel();
    const available = await balance(user.id);

    const full = tier === "full" && !review;
    const profile: PacingProfile = skill?.pacing ?? DEFAULT_PACING;
    let working = project;
    const log: string[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const apply = (ops: OperationInput[]) => applyOperations(working, ops, { validateComponent, validateSfx });
    /** Laudo determinístico do Crítico: ritmo + direção de arte + colisões medidas no quadro. */
    const critique = () => critiqueEdit(working, { skill, screen: screenTexts(working) });

    const context = (p: Project) => `<timeline>\n${buildAgentContext(p, selection)}\n</timeline>`;
    const stills = jpegs(frames).flatMap((f): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: "text", text: `Quadro do vídeo bruto em ${f.t}s:` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
    ]);
    const budget = `<orcamento_de_ritmo>\n${budgetText(profile, projectDuration(project))}\n</orcamento_de_ritmo>`;

    /** Registra o custo real e cobra os créditos. Só cobra quando a timeline realmente mudou. */
    const settle = async () => {
      // Administradores não consomem créditos: o custo real é registrado, o débito é zero.
      const credits = log.length && user.role !== "admin" ? price : 0;
      if (usage.input || usage.output)
        await recordUsage({ userId: user.id, kind: "agent", provider: "anthropic", model, tokens: usage, costUSD: anthropicCostUSD(model, usage), credits });
      return { credits, balance: credits ? await charge(user.id, credits, "pedido ao agente") : available };
    };

    /** Um turno de um dos papéis, em streaming: avisa o navegador assim que uma ferramenta começa a ser usada. */
    const runTurn = async (role: AgentRole, messages: Anthropic.Beta.BetaMessageParam[], send: (e: AgentEvent) => void, status: (tool: string) => string) => {
      const { system, tools } = AGENT_ROLES[role];
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 16000,
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          // Raciocínio estendido na direção e na execução completas; o ajuste pontual responde direto.
          ...(full ? { thinking: { type: "adaptive" as const }, output_config: { effort: "high" as const } } : review || tier === "sweep" ? { thinking: { type: "adaptive" as const }, output_config: { effort: "medium" as const } } : {}),
          tools,
          messages,
          ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        // Se o usuário fechar a aba, a chamada ao modelo é cancelada e para de custar.
        { signal: req.signal },
      );
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") send({ type: "status", role, text: status(ev.content_block.name) });
      });
      const response = await stream.finalMessage();
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
      return response;
    };
    const textOf = (response: Anthropic.Beta.BetaMessage) =>
      response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

    /** DIRETOR: lê o material e devolve o plano por atos. Não edita nada. */
    const direct = async (send: (e: AgentEvent) => void): Promise<{ plan: EditPlan; notes: string } | { refusal: string }> => {
      send({ type: "status", role: "director", text: "O Diretor está assistindo ao vídeo inteiro…" });
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        ...history.map((h) => ({ role: h.role, content: h.text })),
        { role: "user", content: [...stills, { type: "text", text: `${context(project)}\n\n${budget}\n\n<pedido>\n${message}\n</pedido>` }] },
      ];
      for (let turn = 0; turn < MAX_TURNS_DIRECTOR; turn++) {
        const response = await runTurn("director", messages, send, (tool) => (tool === "read_words" ? "Conferindo a transcrição…" : "Planejando o vídeo por atos…"));
        if (response.stop_reason === "refusal") return { refusal: "Não posso ajudar com esse pedido. Tente descrever a edição de outra forma." };
        if (response.stop_reason !== "tool_use") {
          // O Diretor só entrega por plan_edit: sem plano, cobra uma vez mais.
          messages.push({ role: "assistant", content: response.content }, { role: "user", content: "Registre o plano com plan_edit (resumo, diagnóstico, acabamento e os trechos por ato)." });
          continue;
        }
        messages.push({ role: "assistant", content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        let accepted: { plan: EditPlan; notes: string } | null = null;
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          if (block.name === "read_words") {
            results.push(readWords(working, block.id, block.input));
            continue;
          }
          const plan = PlanSchema.safeParse(block.input);
          if (!plan.success) {
            results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `Plano inválido: ${z.prettifyError(plan.error)}` });
            continue;
          }
          try {
            accepted = { plan: plan.data, notes: reviewPlan(working, plan.data, profile) };
            results.push({ type: "tool_result", tool_use_id: block.id, content: accepted.notes });
          } catch (e) {
            results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: `${(e as Error).message}\nCorrija as âncoras e envie o plano de novo.` });
          }
        }
        if (accepted) return accepted;
        messages.push({ role: "user", content: results });
      }
      throw new HttpError(502, "O Diretor não conseguiu fechar um plano para este vídeo. Tente de novo.");
    };

    /** EDITOR (e CRÍTICO visual): executa por tool calling tipado sobre as operações do core. */
    const edit = async (role: "editor" | "critic", messages: Anthropic.Beta.BetaMessageParam[], send: (e: AgentEvent) => void): Promise<string> => {
      let finalText = "";
      let cycles = 0;
      const maxTurns = full ? MAX_TURNS_EDITOR : tier === "sweep" ? MAX_TURNS_SWEEP : MAX_TURNS;
      for (let turn = 0; turn < maxTurns; turn++) {
        const response = await runTurn(role, messages, send, (tool) =>
          tool === "read_words" ? "Conferindo a transcrição…" : role === "critic" ? "O Crítico está corrigindo o que viu…" : cycles ? "Corrigindo o que o Crítico apontou…" : log.length ? "Aplicando a próxima etapa…" : "O Editor está montando a edição…",
        );
        finalText = textOf(response);
        if (response.stop_reason === "refusal") return "Não posso ajudar com esse pedido. Tente descrever a edição de outra forma.";
        if (response.stop_reason === "max_tokens") return finalText || "A resposta ficou longa demais e foi interrompida. Tente dividir o pedido em partes.";
        if (response.stop_reason !== "tool_use") {
          // Crítico determinístico: a montagem pronta é auditada e o laudo volta ao Editor antes da entrega (até 3 ciclos).
          if (role === "editor" && full && log.length && cycles < MAX_CRITIC_CYCLES && turn < maxTurns - 1) {
            const audit = auditPacing(working, profile);
            const issues = critique();
            if (audit.issues.some((i) => i.severity === "erro") || issues.some((i) => i.severity === "erro")) {
              cycles++;
              send({ type: "status", role: "critic", text: `O Crítico está avaliando a montagem (ciclo ${cycles} de ${MAX_CRITIC_CYCLES})…` });
              messages.push({ role: "assistant", content: response.content });
              messages.push({
                role: "user",
                content: `Autoavaliação antes da entrega (ciclo ${cycles} de ${MAX_CRITIC_CYCLES}). A edição ainda não está no padrão:\n\n${timelineView(working)}\n\n${visualsReport(working)}\n\n${pacingReport(audit)}\n\n${critiqueReport(issues)}\n\nCorrija com edit_timeline (os ids de clip estão nos laudos) e só então dê a resposta final.`,
              });
              continue;
            }
          }
          return finalText;
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
          const input = ToolInputSchema.safeParse(block.input);
          if (!input.success) {
            fail(`Entrada inválida: ${z.prettifyError(input.error)}`);
            continue;
          }
          try {
            const result = apply(input.data.operations as OperationInput[]);
            working = result.project;
            log.push(...result.log);
            // A timeline do usuário é atualizada agora, sem esperar o agente terminar.
            send({ type: "ops", project: working, log: result.log });
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Aplicado:\n${result.log.map((l) => `- ${l}`).join("\n")}\nDuração atual: ${projectDuration(working)}s. As âncoras (ids de palavra e tempos do bruto) continuam as mesmas.${full ? `\n\n${visualsReport(working)}\n\n${pacingReport(auditPacing(working, profile))}` : ""}`,
            });
          } catch (e) {
            fail(`${(e as Error).message}\nNenhuma operação desta chamada foi aplicada. Corrija e envie a lista completa de novo.`);
          }
        }
        messages.push({ role: "user", content: results });
      }
      return finalText;
    };

    const run = async (send: (e: AgentEvent) => void) => {
      // ---------- Crítico visual ----------
      if (review && pass) {
        send({ type: "status", role: "critic", text: `O Crítico está conferindo os quadros do vídeo editado (ciclo ${pass.n + 1} de ${MAX_CRITIC_CYCLES})…` });
        const shots = jpegs(review.shots);
        const strip = review.strip && jpegs([{ data: review.strip }]).length ? review.strip : null;
        const text = await edit(
          "critic",
          [
            {
              role: "user",
              content: [
                ...(strip
                  ? ([
                      { type: "text", text: "Tira de diagnóstico (timeline_view): miniaturas nos pontos de corte, com a caixa do sujeito detectado, e a forma de onda do áudio embaixo." },
                      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: strip } },
                    ] satisfies Anthropic.Beta.BetaContentBlockParam[])
                  : []),
                ...shots.flatMap((f): Anthropic.Beta.BetaContentBlockParam[] => [
                  { type: "text", text: `Quadro do vídeo EDITADO em ${f.t}s da timeline:` },
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.data } },
                ]),
                { type: "text", text: `<timeline>\n${buildAgentContext(project, null)}\n</timeline>\n\n${timelineView(project)}\n\n${visualsReport(project)}\n\n${critiqueReport(critique())}\n\nAvalie a montagem e corrija só os defeitos reais.` },
              ],
            },
          ],
          send,
        );
        const bill = await settle();
        // Corrigiu algo e ainda há ciclos: o navegador captura de novo e o Crítico reavalia.
        const next = log.length && pass.n + 1 < MAX_CRITIC_CYCLES ? reviewToken(user.id, pass.n + 1, skill?.id) : undefined;
        send({ type: "done", message: plainMessage(text) || "ok", project: working, log, ...bill, ...(next ? { reviewToken: next } : {}) });
        return;
      }

      // ---------- Pedido pontual: Editor direto ----------
      if (!full) {
        send({ type: "status", role: "editor", text: "Lendo a transcrição…" });
        const text = await edit("editor", [...history.map((h) => ({ role: h.role, content: h.text })), { role: "user", content: `${context(project)}\n\n<pedido>\n${message}\n</pedido>` }], send);
        const bill = await settle();
        send({ type: "done", message: plainMessage(text) || (log.length ? "Edição aplicada." : "Não fiz alterações."), project: working, log, ...bill });
        return;
      }

      // ---------- Edição completa: Diretor → (confirmação) → Editor → Crítico ----------
      let plan = confirmed?.plan ?? null;
      let notes = "";
      if (!plan) {
        const directed = await direct(send);
        if ("refusal" in directed) {
          const bill = await settle();
          send({ type: "done", message: directed.refusal, project: working, log, ...bill });
          return;
        }
        ({ plan, notes } = directed);
        if (phase === "plan") {
          // O plano vai para o chat e espera o "sim" do usuário: nada foi editado nem cobrado.
          send({ type: "plan", plan, planToken: planToken(user.id, plan) });
          const bill = await settle();
          send({ type: "done", message: plan.resumo, project: working, log, ...bill, awaitingConfirmation: true });
          return;
        }
        send({ type: "plan", plan });
      } else {
        try {
          notes = reviewPlan(working, plan, profile);
        } catch {
          // O projeto mudou desde o plano (ex.: o usuário cortou algo): o Editor segue pelo texto do plano.
          notes = "Algumas âncoras do plano já não estão na timeline; siga a intenção de cada trecho.";
        }
      }
      send({ type: "status", role: "editor", text: "O Editor está montando a edição…" });
      const text = await edit(
        "editor",
        [
          {
            role: "user",
            content: [
              ...stills,
              {
                type: "text",
                text: `${context(project)}\n\n${budget}\n\n<pedido>\n${message}\n</pedido>\n\n<plano_do_diretor>\n${JSON.stringify(plan)}\n</plano_do_diretor>\n\n<conferencia_do_plano>\n${notes}\n</conferencia_do_plano>\n\nExecute o plano em etapas com edit_timeline: (a) cortes, (b) velocidade, (c) câmera, (d) motion e legendas, (e) imagem e som.`,
              },
            ],
          },
        ],
        send,
      );
      // O que ainda colide depois da revisão é podado de forma determinística.
      if (log.length) {
        const pruned = enforcePacing(working, profile);
        if (pruned.log.length) {
          working = pruned.project;
          log.push(...pruned.log);
          send({ type: "ops", project: working, log: pruned.log });
        }
      }
      const bill = await settle();
      send({ type: "done", ...(log.length ? { reviewToken: reviewToken(user.id, 0, skill?.id) } : {}), message: plainMessage(text) || (log.length ? "Edição aplicada." : "Não fiz alterações."), project: working, log, ...bill });
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

/** Trecho de um capítulo na timeline atual, por palavra ou por tempo do vídeo bruto. */
function chapterSpan(project: Project, c: EditPlan["capitulos"][number], words: ReturnType<typeof timelineWords>): { start: number; end: number; ref: string } {
  if (c.fromWord && c.toWord) {
    const a = timelineWord(project, c.fromWord, words);
    const b = timelineWord(project, c.toWord, words);
    return { start: a.start, end: b.end, ref: `${c.fromWord}–${c.toWord}` };
  }
  if (c.fromSource !== undefined && c.toSource !== undefined) {
    const assetId = [...mainClips(project)].sort((x, y) => x.start - y.start)[0]?.assetId;
    const ranges = assetId ? sourceRangesToTimeline(project, assetId, [{ start: Math.min(c.fromSource, c.toSource), end: Math.max(c.fromSource, c.toSource) }]) : [];
    if (!ranges.length) throw new Error(`o trecho ${c.fromSource}–${c.toSource}s do vídeo bruto não está na timeline`);
    return { start: ranges[0]!.start, end: ranges[ranges.length - 1]!.end, ref: `bruto ${c.fromSource}–${c.toSource}s` };
  }
  throw new Error(`o trecho "${c.titulo}" precisa de fromWord/toWord ou fromSource/toSource`);
}

/** Confere o plano contra a timeline e o orçamento; o que volta guia a execução. */
function reviewPlan(project: Project, plan: EditPlan, profile: PacingProfile): string {
  const words = timelineWords(project);
  const duration = projectDuration(project);
  const minutes = Math.max(duration / 60, 0.25);
  const lines = ["Plano registrado. Trechos na timeline atual:"];
  let zooms = 0;
  let components = 0;
  let prevEnd = 0;
  const notes: string[] = [];
  plan.capitulos.forEach((c, i) => {
    const s = chapterSpan(project, c, words);
    const len = Math.round((s.end - s.start) * 10) / 10;
    zooms += c.zooms;
    components += c.componentes;
    lines.push(`${i + 1}. ${ACT_NAMES[c.ato]} — ${c.titulo} [${s.ref}] ${s.start}–${s.end}s (${len}s), energia ${c.energia}, velocidade ${c.velocidade}: ${c.zooms} zoom(s), ${c.componentes} componente(s), ${c.sons} som(ns)`);
    if (i === 0 && c.ato !== "gancho") notes.push("O primeiro trecho deve ser o gancho.");
    if (s.start - prevEnd > 3) notes.push(`Há ${Math.round(s.start - prevEnd)}s de vídeo sem trecho antes de "${c.titulo}": o plano precisa cobrir o vídeo inteiro (ou diga em "cortes" que esse pedaço sai).`);
    if (c.componentes && len / c.componentes < profile.componentGap) notes.push(`Trecho ${i + 1}: ${c.componentes} componentes em ${len}s não cabem (mínimo ${profile.componentGap}s entre eles).`);
    if (len > profile.maxStatic && c.zooms + c.componentes === 0 && c.velocidade === "normal") notes.push(`Trecho ${i + 1}: ${len}s sem nada na tela passa do limite de ${profile.maxStatic}s.`);
    prevEnd = s.end;
  });
  if (duration - prevEnd > 3) notes.push(`Os últimos ${Math.round(duration - prevEnd)}s não estão em nenhum trecho.`);
  for (const act of ["gancho", "climax", "fecho"] as const) if (!plan.capitulos.some((c) => c.ato === act)) notes.push(`O plano não tem ${ACT_NAMES[act].toLowerCase()}: todo vídeo tem gancho, desenvolvimento, clímax e fecho.`);
  const check = (n: number, [min, max]: [number, number], what: string) => {
    const lo = Math.floor(min * minutes);
    const hi = Math.max(1, Math.ceil(max * minutes));
    if (n < lo || n > hi) notes.push(`O plano soma ${n} ${what}; o orçamento deste vídeo é de ${lo} a ${hi}. Ajuste na execução.`);
  };
  check(zooms, profile.zoomsPerMin, "zooms");
  check(components, profile.componentsPerMin, "componentes");
  lines.push(`Total planejado: ${zooms} zooms, ${components} componentes. Acabamento: cor ${plan.estilo.look}, trilha ${plan.estilo.musica}, legenda ${plan.estilo.legenda ?? "nenhuma"}.`);
  if (notes.length) lines.push("", "Ajustes necessários no plano (o Editor aplica na execução):", ...notes.map((n) => `- ${n}`));
  return lines.join("\n");
}
