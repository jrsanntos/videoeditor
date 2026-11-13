import { cookies } from "next/headers";
import { appUrl } from "@/server/email";
import { exchangeCode, OAUTH_COOKIE, safeNext } from "@/server/google";
import { clientIp, rateLimit } from "@/server/ratelimit";
import { HttpError, signInWithGoogle, startSession } from "@/server/users";

export const runtime = "nodejs";

/** Retorno do Google: confere o `state`, troca o código, entra (ou cria a conta) e segue para o destino. */
export async function GET(req: Request) {
  const base = appUrl(req);
  const to = (path: string) => Response.redirect(`${base}${path}`, 303);
  const jar = await cookies();
  const raw = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  try {
    await rateLimit("loginIp", clientIp(req));
    const url = new URL(req.url);
    // Cancelou na tela do Google: volta sem mensagem de erro.
    if (url.searchParams.get("error")) return to("/login");
    const saved = raw ? (JSON.parse(raw) as { state?: string; next?: string }) : null;
    const code = url.searchParams.get("code");
    if (!saved?.state || !code || saved.state !== url.searchParams.get("state")) throw new HttpError(400, "Sessão de login expirada.");
    const identity = await exchangeCode(code, base);
    const { user } = await signInWithGoogle(identity);
    await startSession(user.id);
    return to(safeNext(saved.next));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error("login com Google falhou", e);
    const banned = e instanceof HttpError && e.status === 403 && /suspensa/.test(e.message);
    return to(`/login?google=${banned ? "suspensa" : "erro"}`);
  }
}
