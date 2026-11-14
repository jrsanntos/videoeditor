import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Transcript } from "@videoeditor/core";
import { getSetting } from "./settings";
import { HttpError } from "./errors";

/** Limite do endpoint de transcrição por arquivo. Em Opus 32 kbps (~0,24 MB/min) cabem ~100 min; em WAV, ~13 min. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Edição completa (skills, direção do vídeo inteiro): o modelo principal. */
export const agentModel = async () => (await getSetting("AGENT_MODEL")) || "claude-sonnet-5-5";
/** Ajustes pontuais: modelo rápido, uma fração do custo por comando. */
export const fastAgentModel = async () => (await getSetting("AGENT_MODEL_FAST")) || "claude-haiku-5-5";
/**
 * Editor da edição completa: executa um plano já decidido pelo Diretor (o
 * julgamento caro fica com o Diretor). Padrão definido pela medição de custo e
 * qualidade com vídeo real (ver README, "Custos").
 */
export const editorAgentModel = async () => (await getSetting("AGENT_MODEL_EDITOR")) || EDITOR_DEFAULT;
/** Crítico visual: confere quadros e corrige defeitos pontuais. */
export const criticAgentModel = async () => (await getSetting("AGENT_MODEL_CRITIC")) || CRITIC_DEFAULT;
// Editor e Crítico executam e conferem o plano do Diretor: no Haiku, a mesma edição sai ~4× mais
// barata (medido no vídeo real: US$ 0,07–0,11 contra 0,28–0,48 com Sonnet nos três papéis).
const EDITOR_DEFAULT = "claude-haiku-5-5";
const CRITIC_DEFAULT = "claude-haiku-5-5";

/** Cliente Anthropic com a chave do painel (ou do ambiente). */
export async function anthropicClient(): Promise<Anthropic> {
  const apiKey = await getSetting("ANTHROPIC_API_KEY");
  if (!apiKey)
    throw new HttpError(
      503,
      "O agente de IA não está configurado: cadastre a chave da Anthropic no painel de administração (ou defina ANTHROPIC_API_KEY). A edição manual e a remoção local de silêncios funcionam sem ela.",
    );
  return new Anthropic({ apiKey });
}

/**
 * A falha da Anthropic justifica seguir no modelo reserva? Sim quando o
 * problema é do fornecedor (saldo, chave, sobrecarga, fora do ar, rede); não
 * quando é do pedido (400 comum) ou o usuário cancelou.
 */
export function shouldFallBack(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (e instanceof Anthropic.BadRequestError) return /credit balance|billing|quota/i.test(e.message);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError || e instanceof Anthropic.RateLimitError) return true;
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError) return typeof e.status === "number" && e.status >= 500;
  return false;
}

/**
 * Converte falhas da API da Anthropic em mensagens que o USUÁRIO entende.
 * Detalhe operacional (saldo da conta, chave recusada) vai só para o log do
 * servidor: o cliente vê que o serviço está indisponível e que nada foi cobrado.
 */
export function anthropicError(e: unknown): HttpError | null {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    console.error("ALERTA OPERACIONAL: a chave da Anthropic foi recusada. Atualize-a no painel de administração.", e.message);
    return new HttpError(503, "O serviço de IA está indisponível no momento. Nada foi cobrado. Tente de novo em alguns minutos.");
  }
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, "Muitas pessoas usando a IA agora. Aguarde alguns segundos e tente de novo.");
  if (e instanceof Anthropic.BadRequestError && /credit balance|billing|quota/i.test(e.message)) {
    console.error("ALERTA OPERACIONAL: a conta da Anthropic está sem saldo. Adicione créditos no Console da Anthropic (ou configure o modelo reserva GEMINI_API_KEY).", e.message);
    return new HttpError(503, "O serviço de IA está indisponível no momento. Nada foi cobrado. Tente de novo em alguns minutos.");
  }
  if (e instanceof Anthropic.APIError) {
    console.error("anthropic api error", e.status, e.message);
    return new HttpError(502, "O serviço de IA falhou ao processar o pedido. Tente novamente.");
  }
  return null;
}

type GroqVerbose = {
  language?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: { start: number; end: number; avg_logprob?: number; no_speech_prob?: number }[];
};

/**
 * Dica de contexto para o transcritor, por idioma. O Whisper tende a "limpar"
 * a fala (apaga "hum", gaguejos e repetições); um texto de exemplo com essas
 * marcas faz ele transcrever como foi dito — é disso que a limpeza de erros e
 * de muletas precisa para enxergar o que cortar.
 */
const VERBATIM_HINT: Record<string, string> = {
  pt: "Hum, é... então, tipo, eu, eu acho que, ahn, a gente precisa, né, vender mais. O o segredo é, eeh, é consistência. Hummm, estão, estão causando.",
  en: "Um, uh... so, like, I, I think that, uh, we need to, you know, sell more. The the secret is, is consistency.",
  es: "Eh, este... o sea, yo, yo creo que, eh, tenemos que, ¿sabes?, vender más. El el secreto es, es constancia.",
};

/** Idiomas em que a dica e o idioma fixo valem; fora deles o transcritor detecta sozinho. */
export const TRANSCRIBE_LANGUAGES = Object.keys(VERBATIM_HINT);

/**
 * Confiança de cada palavra, a partir do trecho (segmento) em que ela cai:
 * probabilidade média do segmento, derrubada quando o transcritor achou que
 * ali não havia fala (onde costuma inventar texto).
 */
export function wordConfidence(words: { start: number; end: number }[], segments: GroqVerbose["segments"] = []): (number | undefined)[] {
  return words.map((w) => {
    const mid = (w.start + w.end) / 2;
    const seg = segments.find((s) => mid >= s.start && mid <= s.end) ?? segments.find((s) => w.start < s.end && w.end > s.start);
    if (!seg || seg.avg_logprob === undefined) return undefined;
    const p = Math.exp(seg.avg_logprob) * (1 - Math.min(1, Math.max(0, (seg.no_speech_prob ?? 0) - 0.3)));
    return Math.round(Math.min(1, Math.max(0, p)) * 100) / 100;
  });
}

type Pass = { language?: string; prompt?: string; model?: string };

/**
 * Modelos de transcrição. O turbo só detecta o idioma; o passe literal usa o
 * large-v3 completo, que escreve hesitações ("hum", "é...") que o turbo engole
 * na duração da palavra vizinha (medido no vídeo real de teste).
 */
export const WHISPER_FAST = "whisper-large-v3-turbo";
export const WHISPER_VERBATIM = "whisper-large-v3";

async function whisper(key: string, file: Blob, pass: Pass): Promise<GroqVerbose> {
  const body = new FormData();
  // O provedor identifica o formato pela extensão do nome.
  body.append("file", file, file.type.includes("webm") ? "audio.webm" : "audio.wav");
  body.append("model", pass.model ?? WHISPER_FAST);
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");
  body.append("timestamp_granularities[]", "segment");
  if (pass.language) body.append("language", pass.language);
  if (pass.prompt) body.append("prompt", pass.prompt);
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body,
  }).catch((e: unknown) => {
    console.error("transcribe network error", e);
    return null;
  });
  if (!res) throw new HttpError(502, "Não foi possível conectar ao serviço de transcrição.");
  if (res.status === 401) throw new HttpError(503, "A chave da Groq configurada foi recusada. Atualize-a no painel.");
  if (!res.ok) {
    console.error("transcribe error", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "O serviço de transcrição falhou. Tente novamente.");
  }
  return (await res.json()) as GroqVerbose;
}

/** Dica para reouvir um trecho curto: só o que foi dito, inclusive os sons de hesitação. */
const SPAN_HINT: Record<string, string> = {
  pt: "Transcrição literal, palavra por palavra, com hesitações e sons: hum, hummm, ahn, é..., eeh, ééé.",
  en: "Verbatim, word by word, with hesitations and sounds: um, umm, uh, er, ah.",
  es: "Transcripción literal, palabra por palabra, con vacilaciones y sonidos: eh, ehh, mmm, este.",
};

/**
 * Reouve trechos curtos (WAV de poucos segundos) onde uma palavra durou demais
 * para o ritmo da pessoa: é onde o transcritor esconde um "hum" ou um "é...".
 * Devolve as palavras de cada trecho, com tempos relativos ao trecho.
 */
export async function transcribeSpans(spans: Blob[], language: string): Promise<{ words: { text: string; start: number; end: number }[] }[]> {
  const key = await getSetting("GROQ_API_KEY");
  if (!key) throw new HttpError(503, "A transcrição não está configurada.");
  const lang = TRANSCRIBE_LANGUAGES.includes(language) ? language : "pt";
  return Promise.all(
    spans.map(async (file) => {
      const data = await whisper(key, file, { language: lang, model: WHISPER_VERBATIM, prompt: SPAN_HINT[lang] }).catch(() => null);
      return { words: (data?.words ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w.word)).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end })) };
    }),
  );
}

/** Nome de idioma devolvido pelo transcritor ("Portuguese") → código ("pt"). */
const LANGUAGE_CODES: Record<string, string> = { portuguese: "pt", english: "en", spanish: "es" };
const languageCode = (l?: string) => (l ? (LANGUAGE_CODES[l.toLowerCase()] ?? (l.length <= 3 ? l.toLowerCase() : undefined)) : undefined);

/**
 * Transcrição com timestamps por palavra via Groq Whisper.
 *
 * O idioma vem do PRÓPRIO ÁUDIO, nunca do navegador: com o idioma errado
 * fixado o Whisper traduz a fala (um brasileiro com o sistema em inglês
 * receberia legendas em inglês). Primeiro passe sem idioma, só para detectar;
 * se for um idioma com dica de fala literal, um segundo passe com o idioma e a
 * dica (preserva hesitações e repetições, que a limpeza precisa ver). O custo
 * da transcrição é ínfimo perto da edição; o segundo passe vale a pena.
 */
export async function transcribeAudio(file: Blob, opts: { language?: string; vocabulary?: string[] } = {}): Promise<{ transcript: Transcript; seconds: number }> {
  const key = await getSetting("GROQ_API_KEY");
  if (!key)
    throw new HttpError(
      503,
      "A transcrição não está configurada: cadastre a chave da Groq no painel de administração (ou defina GROQ_API_KEY). Sem ela, use a remoção local de silêncios e a edição manual.",
    );
  if (file.size > MAX_AUDIO_BYTES)
    throw new HttpError(413, "Áudio acima de 25 MB. Divida o vídeo em partes menores.");

  // Idioma escolhido explicitamente pelo usuário vale; senão, o detectado no áudio.
  let data: GroqVerbose | null = null;
  let language = opts.language && TRANSCRIBE_LANGUAGES.includes(opts.language) ? opts.language : undefined;
  if (!language) {
    data = await whisper(key, file, {});
    language = languageCode(data.language);
  }
  if (language && TRANSCRIBE_LANGUAGES.includes(language)) {
    // Vocabulário do usuário entra na dica: nomes e termos saem escritos do jeito certo.
    // O transcritor só lê o fim de uma dica longa, então ela é curta.
    const vocabulary = (opts.vocabulary ?? []).map((v) => v.trim()).filter(Boolean).join(", ").slice(0, 500);
    const verbatim = await whisper(key, file, { language, model: WHISPER_VERBATIM, prompt: vocabulary ? `${VERBATIM_HINT[language]} ${vocabulary}.` : VERBATIM_HINT[language] }).catch((e: unknown) => {
      // O primeiro passe já serve: a dica é uma melhoria, não um requisito.
      if (data) return data;
      throw e;
    });
    data = verbatim;
  }
  if (!data) data = await whisper(key, file, {});
  // Vídeo sem fala (cena de ação, b-roll, demonstração muda) é um vídeo válido: transcrição vazia, não erro.
  // Pontuação solta ("." num trecho de ruído) não é palavra.
  const raw = (data.words ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w.word));
  const confidence = wordConfidence(raw, data.segments);
  const words = raw.map((w, i) => ({ id: `w${i}`, text: w.word.trim(), start: w.start, end: w.end, ...(confidence[i] !== undefined ? { confidence: confidence[i] } : {}) }));
  return {
    transcript: { language: language ?? data.language, words },
    seconds: data.duration ?? words[words.length - 1]?.end ?? 0,
  };
}

// Os três papéis do agente (Diretor, Editor, Crítico), com prompts e ferramentas próprios.
export * from "./agents";
