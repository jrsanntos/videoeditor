import { after } from "next/server";
import { z } from "zod";
import { appUrl, sendEmail, verifyEmailMessage } from "@/server/email";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { createEmailVerification, errorResponse, findUnverified, HttpError, normalizeEmail, VERIFY_LINK_HOURS } from "@/server/users";

export const runtime = "nodejs";

const Body = z.object({ email: z.email().max(200) });

/** Reenvia o link de confirmação. A resposta é a mesma exista ou não uma conta pendente. */
export async function POST(req: Request) {
  try {
    await rateLimit("verifyIp", clientIp(req));
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Informe um e-mail válido.");
    const email = normalizeEmail(parsed.data.email);
    await rateLimit("verifyEmail", email);
    const baseUrl = appUrl(req);
    const user = await findUnverified(email);
    if (user) {
      const token = await createEmailVerification(user.id);
      const link = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
      after(() => sendEmail({ to: user.email, ...verifyEmailMessage(user.name, link, VERIFY_LINK_HOURS) }));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
