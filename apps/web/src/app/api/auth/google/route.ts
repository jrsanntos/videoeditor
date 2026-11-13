import { cookies } from "next/headers";
import { randomToken } from "@/server/crypto";
import { appUrl } from "@/server/email";
import { authorizeUrl, googleConfig, OAUTH_COOKIE, safeNext } from "@/server/google";

export const runtime = "nodejs";

/** Início do login com Google: guarda o `state` num cookie e manda para a tela de contas do Google. */
export async function GET(req: Request) {
  const base = appUrl(req);
  const cfg = await googleConfig().catch(() => null);
  if (!cfg) return Response.redirect(`${base}/login?google=indisponivel`, 303);
  const state = randomToken();
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 10 * 60,
  });
  return Response.redirect(authorizeUrl(cfg.clientId, base, state), 303);
}
