import { z } from "zod";
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
    const user = createUser(parsed.data);
    await startSession(user.id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
