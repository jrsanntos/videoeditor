import { z } from "zod";
import { rateLimit } from "@/server/ratelimit";
import { searchStock, stockProviders } from "@/server/stock";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

const Query = z.object({
  q: z.string().trim().min(2, "Digite o que procura.").max(80),
  kind: z.enum(["video", "image"]).default("video"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
});

/** Busca vídeos ou fotos gratuitos (Pexels e Pixabay) para usar como mídia de contexto. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const params = Object.fromEntries(new URL(req.url).searchParams);
    // Sem termo: só informa quais bancos estão ligados.
    if (!params.q) return Response.json({ providers: await stockProviders(), items: [] });
    const parsed = Query.safeParse(params);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Busca inválida.");
    await rateLimit("stockSearch", user.id);
    const items = await searchStock(parsed.data.q, parsed.data.kind, parsed.data.orientation);
    return Response.json({ providers: await stockProviders(), items });
  } catch (e) {
    return errorResponse(e);
  }
}
