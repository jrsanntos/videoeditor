import { z } from "zod";
import { creditCost } from "@videoeditor/core";
import { rateLimit } from "@/server/ratelimit";
import { classifyTier, sealTier } from "@/server/tiers";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({ message: z.string().trim().min(1).max(6000), selection: z.boolean().default(false), duration: z.number().min(0).max(4 * 3600) });

/** Nível e preço de um pedido ao agente, antes do envio. O passe garante que o preço mostrado é o cobrado. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Requisição inválida.");
    await rateLimit("agentTier", user.id);
    const { message, selection, duration } = parsed.data;
    const tier = await classifyTier(user.id, message, selection);
    return Response.json({ tier, credits: creditCost({ type: "agent", tier, durationSec: duration }), token: sealTier(user.id, message, tier) });
  } catch (e) {
    return errorResponse(e);
  }
}
