import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { agentTier, AGENT_TIERS, type AgentTier } from "@videoeditor/core";
import { anthropicClient, fastAgentModel } from "./ai";
import { anthropicCostUSD, recordUsage } from "./billing";
import { decrypt, encrypt, sha256 } from "./crypto";

/**
 * Classificação de um pedido ao agente pela intenção, não pelas palavras
 * exatas: "edita tudo pra mim" é uma edição completa, "revise os erros" é uma
 * passada no vídeo todo, "aumenta a legenda" é um ajuste. O modelo rápido
 * decide; o resultado volta selado num passe que a rota do agente aceita, para
 * o preço mostrado antes do envio ser exatamente o cobrado. Se o modelo falhar,
 * vale a classificação determinística.
 */
const SYSTEM = `Classifique o pedido de um usuário ao editor de vídeo com IA em um de três níveis. Responda só com a ferramenta.
- full: o usuário quer o vídeo editado/reeditado como um todo: "edita pra mim", "deixa pronto", "faz no estilo X", "refaz a edição", "monta um vídeo de vendas com isso". Inclui planejar ritmo, cortes, câmera, motion e som.
- sweep: UMA tarefa aplicada ao vídeo inteiro, sem replanejar a edição: "revise os erros de gravação", "tira as muletas", "zoom nas ênfases", "destaque os números", "corrija as legendas", "coloca efeito sonoro nas transições".
- adjust: mudança pontual — um trecho, um elemento, um instante ou uma propriedade: "aumenta a legenda", "tira esse zoom", "troca a cor do card", "corta o começo", "coloca um zoom aqui", perguntas.
Na dúvida entre sweep e adjust, escolha adjust se o pedido cita um instante, um elemento ou "aqui"; senão sweep.`;

const TOOL: Anthropic.Tool = {
  name: "classificar",
  description: "Registra o nível do pedido.",
  input_schema: { type: "object", properties: { nivel: { type: "string", enum: AGENT_TIERS } }, required: ["nivel"] },
};

const TOKEN_MINUTES = 30;
const key = (message: string) => sha256(message.trim());

export function sealTier(userId: string, message: string, tier: AgentTier): string {
  return encrypt(JSON.stringify({ u: userId, k: "tier", m: key(message), t: tier, exp: Date.now() + TOKEN_MINUTES * 60_000 }));
}

/** O nível selado para ESTA mensagem e ESTE usuário, ou null (passe vencido, de outra mensagem ou adulterado). */
export function unsealTier(token: string | undefined, userId: string, message: string): AgentTier | null {
  if (!token) return null;
  try {
    const d = JSON.parse(decrypt(token)) as { u?: string; k?: string; m?: string; t?: AgentTier; exp?: number };
    return d.u === userId && d.k === "tier" && d.m === key(message) && typeof d.exp === "number" && d.exp > Date.now() && d.t && AGENT_TIERS.includes(d.t) ? d.t : null;
  } catch {
    return null;
  }
}

export async function classifyTier(userId: string, message: string, hasSelection: boolean): Promise<AgentTier> {
  // Com trecho selecionado o pedido é pontual por definição; mensagem muito longa é uma direção completa.
  if (hasSelection) return "adjust";
  const fallback = agentTier(message, false);
  if (message.length > 400) return fallback;
  try {
    const client = await anthropicClient();
    const model = await fastAgentModel();
    const res = await client.messages.create(
      { model, max_tokens: 40, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name }, messages: [{ role: "user", content: message.slice(0, 1200) }] },
      { timeout: 6000 },
    );
    const usage = { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: 0, cacheWrite: 0 };
    void recordUsage({ userId, kind: "agent", provider: "anthropic", model, tokens: usage, costUSD: anthropicCostUSD(model, usage), credits: 0 }).catch(() => {});
    const block = res.content.find((b) => b.type === "tool_use");
    const tier = (block?.type === "tool_use" ? (block.input as { nivel?: string }).nivel : undefined) as AgentTier | undefined;
    return tier && AGENT_TIERS.includes(tier) ? tier : fallback;
  } catch {
    return fallback;
  }
}
