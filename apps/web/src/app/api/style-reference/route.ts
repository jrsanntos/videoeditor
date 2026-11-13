import { z } from "zod";
import { rateLimit } from "@/server/ratelimit";
import { extractStyleReference, MeasuredReferenceSchema, profileFromFile } from "@/server/style-reference";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.union([z.object({ url: z.string().min(8).max(300) }), z.object({ file: MeasuredReferenceSchema })]);

/**
 * Referência de inspiração. Duas entradas:
 * - url: um vídeo do YouTube. Lê metadados, capítulos, legendas e a capa; o
 *   ritmo de cortes é ESTIMADO (o vídeo não é baixado).
 * - file: um arquivo enviado pelo usuário, com o ritmo MEDIDO no navegador e
 *   alguns quadros para a leitura visual.
 * Devolve o StyleReferenceProfile que o Diretor de IA usa. Não consome créditos.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe a URL ou o arquivo do vídeo de referência.");
    await rateLimit("styleReference", user.id);
    const body = parsed.data;
    return Response.json({ profile: "file" in body ? await profileFromFile(body.file, user.id) : await extractStyleReference(body.url, user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
