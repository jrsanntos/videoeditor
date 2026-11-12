import { after } from "next/server";
import { z } from "zod";
import { appUrl, passwordResetEmail, sendEmail } from "@/server/email";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { createPasswordReset, errorResponse, HttpError, normalizeEmail, RESET_LINK_MINUTES } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({ email: z.email().max(200) });

/** Pede o link de redefinição. A resposta é a mesma exista ou não a conta. */
export async function POST(req: Request) {
  try {
    await rateLimit("forgotIp", clientIp(req));
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe um e-mail válido.");
    const email = normalizeEmail(parsed.data.email);
    await rateLimit("forgotEmail", email);
    const baseUrl = appUrl(req);
    const reset = await createPasswordReset(email);
    if (reset) {
      const link = `${baseUrl}/redefinir-senha?token=${encodeURIComponent(reset.token)}`;
      // Envio depois da resposta: o tempo de resposta não denuncia se a conta existe.
      after(() => sendEmail({ to: reset.user.email, ...passwordResetEmail(reset.user.name, link, RESET_LINK_MINUTES) }));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
