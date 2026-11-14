import { transcribeSpans, WHISPER_VERBATIM } from "@/server/ai";
import { groqCostUSD, recordUsage } from "@/server/billing";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Trechos por pedido e tamanho de cada um: só palavras suspeitas, nunca o vídeo inteiro. */
const MAX_SPANS = 24;
const MAX_SPAN_BYTES = 400_000; // ~12 s de WAV mono a 16 kHz

/**
 * Segunda escuta dos trechos em que uma palavra durou demais para o ritmo da
 * pessoa (onde a transcrição costuma esconder um "hum" ou um "é..."). Faz
 * parte da transcrição já cobrada: registra o custo real, sem crédito extra.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData().catch(() => null);
    const spans = (form?.getAll("span") ?? []).flatMap((f) => (typeof f === "string" ? [] : [f as Blob]));
    if (!spans.length) throw new HttpError(400, "Nenhum trecho enviado.");
    if (spans.length > MAX_SPANS || spans.some((s) => s.size > MAX_SPAN_BYTES)) throw new HttpError(413, "Trechos demais ou longos demais.");
    const language = String(form?.get("language") ?? "pt").slice(0, 5).toLowerCase();
    const results = await transcribeSpans(spans, language);
    // WAV mono 16 bits a 16 kHz: 32 kB por segundo.
    const seconds = spans.reduce((s, b) => s + Math.max(0, b.size - 44) / 32_000, 0);
    await recordUsage({ userId: user.id, kind: "transcribe", provider: "groq", model: WHISPER_VERBATIM, audioSeconds: seconds, costUSD: groqCostUSD(seconds), credits: 0 });
    return Response.json({ spans: results });
  } catch (e) {
    return errorResponse(e);
  }
}
