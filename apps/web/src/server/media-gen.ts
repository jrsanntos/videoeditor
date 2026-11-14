import "server-only";
import { HttpError } from "./errors";
import { getSetting } from "./settings";

/**
 * Mídia gerada por IA para inserir no vídeo (Google Gemini):
 * - imagem: generateContent com saída IMAGE (modelo GEMINI_IMAGE_MODEL);
 * - vídeo: Interactions API (POST /v1beta/interactions), que o Gemini Omni exige.
 *   A resposta traz o vídeo como arquivo (uri), baixado aqui com a mesma chave.
 * O custo real vai para usage_events; o usuário paga em créditos, e só se deu certo.
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const IMAGE_USD = 0.04;
export const VIDEO_USD_PER_SECOND = 0.07;

export type MediaAspect = "9:16" | "16:9" | "1:1" | "4:3" | "3:4";

async function key(): Promise<string> {
  const k = await getSetting("GEMINI_API_KEY");
  if (!k) throw new HttpError(503, "A geração de imagens e vídeos não está configurada (falta a chave do Gemini).");
  return k;
}

/** Mensagem que o usuário entende, sem detalhes do provedor. */
function failure(status: number, body: string): HttpError {
  console.error("geração de mídia falhou", status, body.slice(0, 400));
  if (status === 429) return new HttpError(429, "O gerador está ocupado agora. Tente de novo em alguns minutos.");
  if (/safety|policy|blocked|prohibited/i.test(body)) return new HttpError(422, "O gerador recusou essa descrição. Tente descrever a cena de outro jeito (sem violência explícita nem pessoas reais).");
  return new HttpError(502, "Não foi possível gerar a mídia agora. Nada foi cobrado.");
}

export async function generateImage(prompt: string, aspect: MediaAspect): Promise<{ data: Buffer; mime: string; model: string }> {
  const model = (await getSetting("GEMINI_IMAGE_MODEL")) || "gemini-nano-banana-2.1";
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": await key() },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
    }),
  }).catch(() => null);
  if (!res) throw new HttpError(502, "Não foi possível conectar ao gerador de imagens.");
  const text = await res.text();
  if (!res.ok) throw failure(res.status, text);
  const json = JSON.parse(text) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] }; finishReason?: string }[] };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) throw failure(422, `sem imagem: ${json.candidates?.[0]?.finishReason ?? "?"} safety`);
  return { data: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType, model };
}

export async function generateVideo(prompt: string, aspect: MediaAspect, seconds: number): Promise<{ data: Buffer; mime: string; model: string; seconds: number }> {
  const model = (await getSetting("GEMINI_VIDEO_MODEL")) || "gemini-omni-1.2-flash";
  const k = await key();
  const dur = Math.max(3, Math.min(8, Math.round(seconds)));
  const res = await fetch(`${BASE}/interactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": k },
    body: JSON.stringify({
      model,
      input: prompt,
      response_format: { type: "video", duration: `${dur}s`, resolution: "720p", aspect_ratio: aspect === "9:16" ? "9:16" : "16:9", delivery: "uri" },
    }),
    signal: AbortSignal.timeout(280_000),
  }).catch(() => null);
  if (!res) throw new HttpError(502, "Não foi possível conectar ao gerador de vídeos.");
  const text = await res.text();
  if (!res.ok) throw failure(res.status, text);
  const json = JSON.parse(text) as { status?: string; steps?: { type: string; content?: { type: string; uri?: string; data?: string; mime_type?: string }[] }[] };
  const out = json.steps?.flatMap((s) => (s.type === "model_output" ? (s.content ?? []) : [])).find((c) => c.type === "video");
  if (!out) throw failure(422, `sem vídeo: ${json.status ?? "?"} safety`);
  if (out.data) return { data: Buffer.from(out.data, "base64"), mime: out.mime_type ?? "video/mp4", model, seconds: dur };
  if (!out.uri?.startsWith(BASE)) throw failure(502, "uri inesperada");
  const file = await fetch(out.uri, { headers: { "x-goog-api-key": k } }).catch(() => null);
  if (!file?.ok) throw failure(file?.status ?? 502, "download do vídeo falhou");
  return { data: Buffer.from(await file.arrayBuffer()), mime: out.mime_type ?? "video/mp4", model, seconds: dur };
}
