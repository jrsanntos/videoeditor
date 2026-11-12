import { appUrl } from "@/server/email";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { startSession, verifyEmail } from "@/server/users";

export const runtime = "nodejs";

/** Link do e-mail de confirmação: confirma a conta, abre a sessão e leva ao editor. */
export async function GET(req: Request) {
  const base = appUrl(req);
  const to = (path: string) => Response.redirect(`${base}${path}`, 303);
  try {
    await rateLimit("verifyIp", clientIp(req));
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const userId = token ? await verifyEmail(token) : null;
    if (!userId) return to("/login?confirmacao=expirada");
    await startSession(userId);
    return to("/app");
  } catch (e) {
    console.error("verificação de e-mail falhou", e);
    return to("/login?confirmacao=expirada");
  }
}
