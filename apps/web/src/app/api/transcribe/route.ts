import { creditCost } from "@videoeditor/core";
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
    // A duração informada só serve para a checagem prévia; a cobrança usa a medida pelo provedor.
    assertCredits(user.id, creditCost({ type: "ingest", durationSec: duration }));

    const { transcript, seconds } = await transcribeAudio(file);
    const credits = creditCost({ type: "ingest", durationSec: seconds });
    recordUsage({
      userId: user.id,
      kind: "transcribe",
      provider: "groq",
      model: "whisper-large-v3-turbo",
      audioSeconds: seconds,
      costUSD: groqCostUSD(seconds),
      credits,
    });
    const balance = charge(user.id, credits, `transcrição (${Math.round(seconds)}s)`);
    return Response.json({ transcript, credits, balance });
  } catch (e) {
    return errorResponse(e);
  }
}
