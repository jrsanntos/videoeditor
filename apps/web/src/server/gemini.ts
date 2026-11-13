import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./errors";
import { getSetting } from "./settings";

/**
 * Modelo reserva do Google (Gemini), usado quando a Anthropic não atende:
 * saldo esgotado, chave recusada, limite de requisições ou serviço fora do ar.
 * A plataforma não pode sair do ar por um fornecedor.
 *
 * O agente fala o formato da Anthropic (mensagens, blocos tool_use /
 * tool_result). Este módulo traduz a conversa para o Gemini e devolve a
 * resposta no mesmo formato, então Diretor, Editor e Crítico seguem iguais.
 * API REST oficial (generativelanguage.googleapis.com, generateContent com
 * chamada de funções).
 */

type Msg = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;
type Tool = Anthropic.Beta.BetaTool;

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiResponse = {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
};

export const geminiModel = async () => (await getSetting("GEMINI_MODEL")) || "gemini-4-hydrogen";
export const geminiConfigured = async () => Boolean(await getSetting("GEMINI_API_KEY"));

/**
 * Preço do modelo reserva em US$ por milhão de tokens, editável no painel.
 * Padrão: tabela pública do gemini-4-hydrogen (lançado em 12/11/2026): US$ 1,50
 * de entrada e 7,50 de saída, fixo em toda a janela de 1 milhão de tokens; o
 * raciocínio é cobrado como saída. A leitura de cache fica em 25% da entrada,
 * acima da tabela do Google, para o teto de custo nunca subestimar o gasto.
 */
export async function geminiPrices(): Promise<{ input: number; output: number; cacheRead: number }> {
  const num = async (key: "GEMINI_PRICE_INPUT" | "GEMINI_PRICE_OUTPUT", fallback: number) => {
    const v = Number(await getSetting(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const input = await num("GEMINI_PRICE_INPUT", 1.5);
  const output = await num("GEMINI_PRICE_OUTPUT", 7.5);
  return { input, output, cacheRead: input * 0.25 };
}

// Conteúdo original de cada resposta do Gemini, para devolvê-lo intacto nas voltas seguintes
// (ele carrega as assinaturas de raciocínio que o Gemini exige junto das chamadas de função).
const originals = new WeakMap<object, GeminiContent>();

/** Prefixo dos ids de tool_use que carregam o id da chamada do próprio Gemini. */
const GEMINI_ID = "gm_";

/** Assinatura neutra para chamadas de função que vieram de outro modelo (a Claude, antes da troca). */
const FOREIGN_SIGNATURE = "skip_thought_signature_validator";

function resultText(content: Anthropic.Beta.BetaToolResultBlockParam["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
}

/** Conversa no formato da Anthropic → `contents` do Gemini. */
export function toGeminiContents(messages: Msg[]): GeminiContent[] {
  const names = new Map<string, string>();
  const out: GeminiContent[] = [];
  const push = (role: GeminiContent["role"], parts: GeminiPart[]) => {
    if (!parts.length) return;
    const last = out[out.length - 1];
    // Mesmo papel em sequência vira uma mensagem só.
    if (last && last.role === role && !originals.has(last)) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : ((m.content ?? []) as Block[]);
    if (m.role === "assistant") {
      for (const b of blocks) if (b.type === "tool_use") names.set(b.id, b.name);
      const original = Array.isArray(m.content) ? originals.get(m.content) : undefined;
      if (original) {
        out.push(original);
        continue;
      }
      push(
        "model",
        blocks.flatMap((b): GeminiPart[] => {
          if (b.type === "text" && b.text.trim()) return [{ text: b.text }];
          if (b.type === "tool_use") return [{ functionCall: { name: b.name, args: (b.input ?? {}) as Record<string, unknown> }, thoughtSignature: FOREIGN_SIGNATURE }];
          return []; // raciocínio e blocos próprios da Anthropic não se traduzem
        }),
      );
      continue;
    }
    push(
      "user",
      blocks.flatMap((b): GeminiPart[] => {
        if (b.type === "text") return b.text.trim() ? [{ text: b.text }] : [];
        if (b.type === "image" && b.source.type === "base64") return [{ inlineData: { mimeType: b.source.media_type, data: b.source.data } }];
        if (b.type === "tool_result") {
          const name = names.get(b.tool_use_id) ?? "edit_timeline";
          // O id liga a resposta à chamada (vale quando o mesmo nome é chamado mais de uma vez na volta).
          const id = b.tool_use_id.startsWith(GEMINI_ID) ? b.tool_use_id.slice(GEMINI_ID.length) : undefined;
          return [{ functionResponse: { ...(id ? { id } : {}), name, response: { [b.is_error ? "error" : "result"]: resultText(b.content) } } }];
        }
        return [];
      }),
    );
  }
  return out;
}

/** JSON Schema → subconjunto aceito em `parameters` (plano B se `parametersJsonSchema` for recusado). */
function openApiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(openApiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (["$schema", "additionalProperties", "default", "$id", "$ref", "$defs", "examples"].includes(k)) continue;
    if (k === "const") out.enum = [v];
    else if (k === "properties" && v && typeof v === "object") out.properties = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, openApiSchema(s)]));
    else out[k] = openApiSchema(v);
  }
  return out;
}

function declarations(tools: Tool[], compat: boolean) {
  return [
    {
      functionDeclarations: tools.map((t) => {
        const { $schema: _s, ...schema } = t.input_schema as Record<string, unknown>;
        return { name: t.name, description: t.description ?? "", ...(compat ? { parameters: openApiSchema(schema) } : { parametersJsonSchema: schema }) };
      }),
    },
  ];
}

/** Espera máxima (s) antes de repetir uma volta recusada por limite de requisições. */
const MAX_RETRY_WAIT_S = 30;
const REFUSAL = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);
let seq = 0;

/**
 * Uma volta do agente no Gemini. Devolve a mensagem no formato da Anthropic
 * (só o que o agente usa: content, stop_reason e usage) e o modelo usado.
 */
export async function geminiTurn(req: { system: string; tools: Tool[]; messages: Msg[]; maxTokens: number; effort?: "low" | "medium" | "high" | null; signal?: AbortSignal }): Promise<{ message: Anthropic.Beta.BetaMessage; model: string }> {
  const key = await getSetting("GEMINI_API_KEY");
  if (!key) throw new HttpError(503, "O modelo reserva (Gemini) não está configurado: cadastre GEMINI_API_KEY no painel.");
  const model = await geminiModel();
  const contents = toGeminiContents(req.messages);
  const call = async (compat: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      signal: req.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents,
        ...(req.tools.length ? { tools: declarations(req.tools, compat), toolConfig: { functionCallingConfig: { mode: "AUTO" } } } : {}),
        // Mesmo nível de raciocínio pedido à Claude (o Diretor pensa mais; quem executa, menos).
        generationConfig: { maxOutputTokens: req.maxTokens, ...(req.effort ? { thinkingConfig: { thinkingLevel: req.effort } } : {}) },
      }),
    }).catch((e: unknown) => {
      if ((e as Error).name === "AbortError") throw e;
      console.error("gemini network error", e);
      return null;
    });
  let res = await call(false);
  if (res && res.status === 400) {
    const body = await res.text().catch(() => "");
    // Versões da API sem JSON Schema completo: tenta o subconjunto OpenAPI.
    if (/parametersJsonSchema|parameters|schema|Unknown name/i.test(body)) res = await call(true);
    else {
      console.error("gemini error 400", body.slice(0, 500));
      throw new HttpError(502, "O modelo reserva recusou o pedido.");
    }
  }
  // Limite por minuto: o Google diz quanto esperar. Se for pouco, espera e tenta uma vez mais.
  if (res && res.status === 429) {
    const body = await res.text().catch(() => "");
    const wait = Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1] ?? NaN);
    if (Number.isFinite(wait) && wait <= MAX_RETRY_WAIT_S && !req.signal?.aborted) {
      console.warn(`gemini 429: nova tentativa em ${wait}s`);
      await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
      res = await call(false);
    } else {
      console.error("gemini error 429", body.slice(0, 500));
      throw new HttpError(429, "Os serviços de IA estão sobrecarregados. Tente de novo em alguns segundos.");
    }
  }
  if (!res) throw new HttpError(502, "Não foi possível conectar ao modelo reserva.");
  if (!res.ok) {
    console.error("gemini error", res.status, (await res.text().catch(() => "")).slice(0, 500));
    throw new HttpError(res.status === 429 ? 429 : 502, res.status === 429 ? "Os serviços de IA estão sobrecarregados. Tente de novo em alguns segundos." : "O serviço de IA falhou ao processar o pedido. Tente novamente.");
  }
  const data = (await res.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  for (const p of parts) {
    if (p.thought) continue;
    if (p.functionCall) content.push({ type: "tool_use", id: p.functionCall.id ? `${GEMINI_ID}${p.functionCall.id}` : `gx_${Date.now().toString(36)}_${seq++}`, name: p.functionCall.name, input: p.functionCall.args ?? {} } as Anthropic.Beta.BetaContentBlock);
    else if (p.text?.trim()) content.push({ type: "text", text: p.text, citations: null } as Anthropic.Beta.BetaContentBlock);
  }
  if (candidate?.content) originals.set(content, { role: "model", parts: candidate.content.parts });
  const u = data.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const stop = content.some((b) => b.type === "tool_use")
    ? "tool_use"
    : data.promptFeedback?.blockReason || REFUSAL.has(candidate?.finishReason ?? "")
      ? "refusal"
      : candidate?.finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : "end_turn";
  const message = {
    id: `gemini_${seq++}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
      output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
  return { message, model };
}

/** Custo (US$) de uma volta no Gemini, pelos preços configurados. */
export async function geminiCostUSD(u: { input: number; output: number; cacheRead: number }): Promise<number> {
  const p = await geminiPrices();
  return (u.input * p.input + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}
