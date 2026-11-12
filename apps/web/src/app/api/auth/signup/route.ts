import { z } from "zod";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { createUser, errorResponse, HttpError, startSession } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(80),
  email: z.email("E-mail inválido.").max(200),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(200),
});

export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    // Depois da validação: erro de digitação no formulário não consome o limite de contas por IP.
    await rateLimit("signupIp", clientIp(req));
    const user = await createUser(parsed.data);
    await startSession(user.id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
