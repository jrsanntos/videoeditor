import { creditCost, PLANS } from "@videoeditor/core";
import { transcribeAudio } from "@/server/ai";
import { assertCredits, charge, groqCostUSD, recordUsage } from "@/server/billing";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Transcrição com timestamps por palavra. Recebe apenas o áudio leve
 * extraído no navegador — o vídeo bruto não sobe. Cobra por minuto de vídeo.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const duration = Number(form?.get("duration"));
    if (!(file instanceof Blob)) throw new HttpError(400, "Áudio ausente.");
    if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(400, "Duração do vídeo ausente.");
    const limit = PLANS[user.plan].maxUploadMinutes;
    if (duration > limit * 60 + 1)
      throw new HttpError(413, `Seu plano aceita vídeos de até ${limit} minutos. Envie um vídeo mais curto ou mude de plano.`);
    // A duração informada só serve para a checagem prévia; a cobrança usa a medida pelo provedor.
    await assertCredits(user.id, creditCost({ type: "ingest", durationSec: duration }));

    const language = String(form?.get("language") ?? "").slice(0, 5).toLowerCase() || undefined;
    let vocabulary: string[] = [];
    try {
      const parsed = JSON.parse(String(form?.get("vocabulary") ?? "[]")) as unknown;
      if (Array.isArray(parsed)) vocabulary = parsed.filter((v): v is string => typeof v === "string").slice(0, 40).map((v) => v.slice(0, 40));
    } catch {
      // vocabulário malformado: transcreve sem ele
    }
    const { transcript, seconds } = await transcribeAudio(file, { language, vocabulary });
    const credits = creditCost({ type: "ingest", durationSec: seconds });
    await recordUsage({
      userId: user.id,
      kind: "transcribe",
      provider: "groq",
      model: "whisper-large-v3-turbo",
      audioSeconds: seconds,
      costUSD: groqCostUSD(seconds),
      credits,
    });
    const balance = await charge(user.id, credits, `transcrição (${Math.round(seconds)}s)`);
    return Response.json({ transcript, credits, balance });
  } catch (e) {
    return errorResponse(e);
  }
}
