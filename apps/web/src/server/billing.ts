import "server-only";
import { db, now, tx } from "./db";
import { HttpError } from "./users";
import { getSetting } from "./settings";

/** Saldo = soma do ledger. */
export function balance(userId: string): number {
  const row = db().prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM credit_ledger WHERE user_id = ?").get(userId) as {
    total: number;
  };
  return Number(row.total);
}

export function addCredits(userId: string, delta: number, reason: string, actorId?: string) {
  db()
    .prepare("INSERT INTO credit_ledger (user_id, delta, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, Math.trunc(delta), reason, actorId ?? null, now());
}

/** Falha cedo, antes de gastar com provedores, se o saldo não cobre a ação. */
export function assertCredits(userId: string, needed: number) {
  const have = balance(userId);
  if (have < needed)
    throw new HttpError(402, `Créditos insuficientes: esta ação custa ${needed} e você tem ${have}.`);
}

/**
 * Cobra uma ação já executada (o provedor já foi pago). Não falha por saldo:
 * a checagem é feita antes com assertCredits; numa corrida rara o saldo pode
 * ficar negativo e bloqueia a próxima ação.
 */
export function charge(userId: string, amount: number, reason: string): number {
  return tx(() => {
    if (amount > 0) addCredits(userId, -amount, reason);
    return balance(userId);
  });
}

// ---------- Custo real dos provedores (despesas automáticas) ----------

/** US$ por milhão de tokens. Cache write = 1,25× entrada; cache read conforme tabela. */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};

/** Groq whisper-large-v3-turbo: US$ 0,04 por hora de áudio (confira a tabela atual do provedor). */
const GROQ_USD_PER_SECOND = 0.04 / 3600;

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function anthropicCostUSD(model: string, u: TokenUsage): number {
  const key = Object.keys(ANTHROPIC_PRICES).find((k) => model.startsWith(k));
  const p = ANTHROPIC_PRICES[key ?? "claude-sonnet-5-5"]!;
  return (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
}

export const groqCostUSD = (audioSeconds: number) => audioSeconds * GROQ_USD_PER_SECOND;

export function recordUsage(e: {
  userId: string | null;
  kind: "agent" | "transcribe" | "template_extract";
  provider: "anthropic" | "groq";
  model?: string;
  tokens?: TokenUsage;
  audioSeconds?: number;
  costUSD: number;
  credits: number;
}) {
  db()
    .prepare(
      `INSERT INTO usage_events (user_id, kind, provider, model, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, audio_seconds, cost_usd, credits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.userId,
      e.kind,
      e.provider,
      e.model ?? null,
      e.tokens?.input ?? 0,
      e.tokens?.output ?? 0,
      e.tokens?.cacheRead ?? 0,
      e.tokens?.cacheWrite ?? 0,
      e.audioSeconds ?? 0,
      e.costUSD,
      e.credits,
      now(),
    );
}

/** Cotação usada para converter o custo dos provedores (US$) em R$. Editável no painel. */
export function usdToBrl(): number {
  const v = Number(getSetting("USD_BRL"));
  return Number.isFinite(v) && v > 0 ? v : 5.4;
}
