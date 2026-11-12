import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Transcript } from "@videoeditor/core";
import { getSetting } from "./settings";
import { HttpError } from "./errors";

/** Limite do endpoint de transcrição por arquivo. 16 kHz mono WAV ≈ 1,9 MB/min → ~13 min. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export const agentModel = async () => (await getSetting("AGENT_MODEL")) || "claude-sonnet-5-5";

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

/** Converte falhas da API da Anthropic em mensagens que o usuário entende. */
export function anthropicError(e: unknown): HttpError | null {
  if (e instanceof Anthropic.AuthenticationError)
    return new HttpError(503, "A chave da Anthropic configurada foi recusada. Atualize-a no painel de administração.");
  if (e instanceof Anthropic.RateLimitError)
    return new HttpError(429, "Muitas requisições ao agente. Aguarde alguns segundos e tente de novo.");
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message))
    return new HttpError(503, "A conta da Anthropic está sem saldo. Adicione créditos no Console da Anthropic.");
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
};

/** Transcrição com timestamps por palavra via Groq Whisper. */
export async function transcribeAudio(file: Blob): Promise<{ transcript: Transcript; seconds: number }> {
  const key = await getSetting("GROQ_API_KEY");
  if (!key)
    throw new HttpError(
      503,
      "A transcrição não está configurada: cadastre a chave da Groq no painel de administração (ou defina GROQ_API_KEY). Sem ela, use a remoção local de silêncios e a edição manual.",
    );
  if (file.size > MAX_AUDIO_BYTES)
    throw new HttpError(413, "Áudio acima de 25 MB (~13 min). Vídeos mais longos serão suportados com o proxy de ingestão.");

  const body = new FormData();
  body.append("file", file, "audio.wav");
  body.append("model", "whisper-large-v3-turbo");
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");

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
  const data = (await res.json()) as GroqVerbose;
  if (!data.words?.length) throw new HttpError(422, "Nenhuma fala foi detectada no áudio.");
  const words = data.words.map((w, i) => ({ id: `w${i}`, text: w.word.trim(), start: w.start, end: w.end }));
  return {
    transcript: { language: data.language, words },
    seconds: data.duration ?? words[words.length - 1]!.end,
  };
}
