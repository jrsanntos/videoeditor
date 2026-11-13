import "server-only";
import { getSettings } from "./settings";
import { HttpError } from "./errors";

/**
 * Login com Google (OAuth 2.0 / OpenID Connect, fluxo de código de
 * autorização). Sem biblioteca: o código é trocado diretamente no endpoint de
 * token do Google, por TLS e com o client secret, então o id_token que volta
 * pode ser lido sem conferir a assinatura (é o que a documentação do Google
 * recomenda para esse caso). Ainda assim conferimos emissor, público e validade.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_COOKIE = "ve_oauth";

export async function googleConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
  const s = await getSettings(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const);
  return s.GOOGLE_CLIENT_ID && s.GOOGLE_CLIENT_SECRET ? { clientId: s.GOOGLE_CLIENT_ID, clientSecret: s.GOOGLE_CLIENT_SECRET } : null;
}

/** Se o botão "Continuar com Google" deve aparecer. Sem banco, simplesmente não aparece. */
export async function googleEnabled(): Promise<boolean> {
  return !!(await googleConfig().catch(() => null));
}

export const redirectUri = (base: string) => `${base}/api/auth/google/callback`;

export function authorizeUrl(clientId: string, base: string, state: string) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(base),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  return `${AUTH_URL}?${q}`;
}

/** Destino depois do login: só caminhos internos (nada de "//outro-site"). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/app";
}

type IdToken = { iss: string; aud: string; sub: string; email?: string; email_verified?: boolean | string; name?: string; given_name?: string; exp: number };

/** Troca o código pelo id_token e devolve a identidade conferida. */
export async function exchangeCode(code: string, base: string): Promise<{ sub: string; email: string; name: string }> {
  const cfg = await googleConfig();
  if (!cfg) throw new HttpError(503, "Login com Google não configurado.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(base),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new HttpError(401, `Google recusou o login${data.error ? ` (${data.error})` : ""}.`);
  const payload = data.id_token.split(".")[1];
  if (!payload) throw new HttpError(401, "Resposta inválida do Google.");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IdToken;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new HttpError(401, "Emissor inválido.");
  if (claims.aud !== cfg.clientId) throw new HttpError(401, "Token emitido para outro aplicativo.");
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, "Login expirado. Tente de novo.");
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === "true"))
    throw new HttpError(403, "Sua conta Google não tem um e-mail verificado.");
  return { sub: claims.sub, email: claims.email, name: claims.name ?? claims.given_name ?? "" };
}
