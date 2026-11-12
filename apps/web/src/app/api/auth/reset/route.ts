import { z } from "zod";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { errorResponse, HttpError, resetPassword } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(200),
});

export async function POST(req: Request) {
  try {
    await rateLimit("resetIp", clientIp(req));
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.find((i) => i.path[0] === "password")?.message ?? "Link inválido. Peça um novo.");
    await resetPassword(parsed.data.token, parsed.data.password);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
