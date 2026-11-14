import "server-only";
import { db } from "./db";
import { sha256 } from "./crypto";
import { HttpError } from "./errors";

/**
 * Limite de requisições por janela fixa, com o contador no Postgres: vale para
 * todas as instâncias da aplicação (um contador em memória não sobrevive a
 * serverless nem a mais de um processo). Um único upsert atômico por checagem.
 */
type Rule = { max: number; windowSec: number };

export const LIMITS = {
  /** Tentativas de login vindas do mesmo IP. */
  loginIp: { max: 20, windowSec: 15 * 60 },
  /** Tentativas de login na mesma conta, de qualquer IP (força bruta distribuída). */
  loginEmail: { max: 8, windowSec: 15 * 60 },
  signupIp: { max: 5, windowSec: 60 * 60 },
  forgotIp: { max: 10, windowSec: 60 * 60 },
  forgotEmail: { max: 3, windowSec: 60 * 60 },
  resetIp: { max: 10, windowSec: 60 * 60 },
  /** Buscas e downloads nos bancos gratuitos de mídia, por conta. */
  stockSearch: { max: 120, windowSec: 60 * 60 },
  stockDownload: { max: 60, windowSec: 60 * 60 },
  /** Análises de vídeo de referência (YouTube), por conta. */
  styleReference: { max: 20, windowSec: 60 * 60 },
  /** Planos do Diretor pedidos sem executar: custam IA e não são cobrados. */
  agentPlan: { max: 12, windowSec: 60 * 60 },
  /** Imagens e vídeos gerados por IA, por conta (cada um já é cobrado em créditos). */
  generateMedia: { max: 30, windowSec: 60 * 60 },
  /** Classificação de pedidos ao agente enquanto a pessoa digita. */
  agentTier: { max: 600, windowSec: 60 * 60 },
  /** Reenvios do e-mail de confirmação. */
  verifyIp: { max: 12, windowSec: 60 * 60 },
  verifyEmail: { max: 4, windowSec: 60 * 60 },
} as const satisfies Record<string, Rule>;

// A chave é guardada como hash: a tabela não acumula IPs nem e-mails em claro.
const keyOf = (scope: keyof typeof LIMITS, id: string) => sha256(`${scope}:${id}`);

/** Conta uma tentativa; lança 429 (com Retry-After) se passou do limite. */
export async function rateLimit(scope: keyof typeof LIMITS, id: string) {
  const rule: Rule = LIMITS[scope];
  const row = await db.one<{ count: number; wait: number }>(
    `INSERT INTO rate_limits AS r (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN r.reset_at <= now() THEN 1 ELSE r.count + 1 END,
       reset_at = CASE WHEN r.reset_at <= now() THEN excluded.reset_at ELSE r.reset_at END
     RETURNING count, CEIL(EXTRACT(EPOCH FROM reset_at - now()))::int AS wait`,
    [keyOf(scope, id), rule.windowSec],
  );
  // Limpeza oportunista das janelas vencidas (índice em reset_at).
  if (Math.random() < 0.02) void db.run("DELETE FROM rate_limits WHERE reset_at < now()").catch(() => {});
  if (row && row.count > rule.max) {
    const wait = Math.max(1, row.wait);
    const minutes = Math.ceil(wait / 60);
    throw new HttpError(429, `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`, wait);
  }
}

/** Zera um contador (ex.: tentativas de login da conta após entrar com sucesso). */
export async function clearRateLimit(scope: keyof typeof LIMITS, id: string) {
  await db.run("DELETE FROM rate_limits WHERE key = $1", [keyOf(scope, id)]);
}

/**
 * IP do cliente para os limites por IP. Atrás de proxy/CDN (Vercel, Cloudflare,
 * nginx) vem em x-forwarded-for; o proxy precisa sobrescrever esse cabeçalho,
 * senão o cliente pode forjá-lo — por isso o login também é limitado por conta.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "desconhecido";
}
