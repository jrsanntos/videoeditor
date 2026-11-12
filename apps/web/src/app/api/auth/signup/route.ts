import { after } from "next/server";
import { z } from "zod";
import { appUrl, emailConfigured, sendEmail, verificationRequired, verifyEmailMessage } from "@/server/email";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { createEmailVerification, createUser, errorResponse, HttpError, startSession, VERIFY_LINK_HOURS } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(80),
  email: z.email("E-mail inválido.").max(200),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(200),
});

/**
 * Cadastro. Com a confirmação de e-mail ativa, a conta nasce pendente: nenhuma
 * sessão é aberta e a pessoa recebe um link; só depois de abri-lo ela entra.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Dados inválidos.");
    // Depois da validação: erro de digitação no formulário não consome o limite de contas por IP.
    await rateLimit("signupIp", clientIp(req));
    const verify = await verificationRequired();
    if (verify && process.env.NODE_ENV === "production" && !(await emailConfigured()))
      throw new HttpError(503, "O cadastro está temporariamente indisponível: o envio de e-mails de confirmação não está configurado.");
    const baseUrl = verify ? appUrl(req) : "";
    const user = await createUser(parsed.data, { verified: !verify });
    if (!verify) {
      await startSession(user.id);
      return Response.json({ ok: true });
    }
    const token = await createEmailVerification(user.id);
    const link = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
    after(() => sendEmail({ to: user.email, ...verifyEmailMessage(user.name, link, VERIFY_LINK_HOURS) }));
    return Response.json({ ok: true, verify: true, email: user.email });
  } catch (e) {
    return errorResponse(e);
  }
}
