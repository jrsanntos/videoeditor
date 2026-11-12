import { z } from "zod";
import { clearRateLimit, clientIp, rateLimit } from "@/server/ratelimit";
import { errorResponse, HttpError, normalizeEmail, startSession, verifyLogin } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().max(200), password: z.string().max(200) });

export async function POST(req: Request) {
  try {
    await rateLimit("loginIp", clientIp(req));
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe e-mail e senha.");
    const email = normalizeEmail(parsed.data.email);
    // Conta toda tentativa na conta, certa ou errada; entrar com sucesso zera o contador.
    await rateLimit("loginEmail", email);
    const user = await verifyLogin(email, parsed.data.password);
    await clearRateLimit("loginEmail", email);
    await startSession(user.id);
    return Response.json({ ok: true, admin: user.role === "admin" });
  } catch (e) {
    return errorResponse(e);
  }
}
