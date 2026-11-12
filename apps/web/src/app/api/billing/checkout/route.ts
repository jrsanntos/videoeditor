import { z } from "zod";
import { appUrl } from "@/server/email";
import { createCheckout } from "@/server/stripe";
import { errorResponse, HttpError, requireUser } from "@/server/users";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), plan: z.enum(["creator", "pro"]) }),
  z.object({ kind: z.literal("topup") }),
]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Pedido inválido.");
    return Response.json({ url: await createCheckout(user, parsed.data, appUrl(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
