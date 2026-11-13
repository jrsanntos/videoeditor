import { z } from "zod";
import { rateLimit } from "@/server/ratelimit";
import { extractStyleReference } from "@/server/style-reference";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({ url: z.string().min(8).max(300) });

/**
 * Referência de inspiração: recebe uma URL do YouTube e devolve o
 * StyleReferenceProfile (ritmo, estrutura, cortes, cores, tipografia) que o
 * Diretor de IA usa para replicar o estilo. Não consome créditos.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe a URL do vídeo de referência.");
    await rateLimit("styleReference", user.id);
    return Response.json({ profile: await extractStyleReference(parsed.data.url, user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
