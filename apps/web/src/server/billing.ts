import "server-only";
import { nextRenewal, PLANS, renewedPlanCredits, splitDebit, type CreditBucket, type PlanId } from "@videoeditor/core";
import { db, tx } from "./db";
import { HttpError } from "./errors";
import { getSetting } from "./settings";

/**
 * Créditos. O ledger (credit_ledger) é o registro contábil e nunca é
 * sobrescrito; users.credits_plan/credits_extra são o saldo materializado,
 * sempre alterado na mesma transação que a linha do ledger.
 */

type Balances = { plan: PlanId; credits_plan: number; credits_extra: number; credits_renew_at: string };

/** Lê a conta com bloqueio de linha: débitos e renovações concorrentes entram em fila. */
async function lockUser(userId: string): Promise<Balances> {
  const row = await db.one<Balances>(
    "SELECT plan, credits_plan, credits_extra, credits_renew_at FROM users WHERE id = $1 FOR UPDATE",
    [userId],
  );
  if (!row) throw new HttpError(404, "Usuário não encontrado.");
  return row;
}

async function ledger(userId: string, delta: number, bucket: CreditBucket, reason: string, actorId?: string | null, ref?: string | null) {
  if (delta === 0) return;
  await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason, actor_id, ref) VALUES ($1, $2, $3, $4, $5, $6)", [
    userId,
    delta,
    bucket,
    reason,
    actorId ?? null,
    ref ?? null,
  ]);
}

export async function balance(userId: string): Promise<number> {
  const row = await db.one<{ total: number }>("SELECT credits_plan + credits_extra AS total FROM users WHERE id = $1", [userId]);
  return row?.total ?? 0;
}

/**
 * Soma créditos a um dos saldos. Com `ref`, é idempotente: a segunda chamada
 * com a mesma referência não credita nada e devolve false.
 */
export async function grantCredits(
  userId: string,
  amount: number,
  bucket: CreditBucket,
  reason: string,
  opts: { actorId?: string; ref?: string } = {},
): Promise<boolean> {
  if (!Number.isInteger(amount * 2) || amount <= 0) throw new Error("grantCredits: quantidade inválida");
  return tx(async () => {
    const inserted = await db.run(
      `INSERT INTO credit_ledger (user_id, delta, bucket, reason, actor_id, ref) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING`,
      [userId, amount, bucket, reason, opts.actorId ?? null, opts.ref ?? null],
    );
    if (!inserted) return false;
    await db.run(`UPDATE users SET ${bucket === "plan" ? "credits_plan = credits_plan" : "credits_extra = credits_extra"} + $2 WHERE id = $1`, [
      userId,
      amount,
    ]);
    return true;
  });
}

/** Debita `amount` (plano primeiro, depois extra) e devolve o novo saldo total. */
async function debit(userId: string, amount: number, reason: string, actorId?: string): Promise<number> {
  return tx(async () => {
    const u = await lockUser(userId);
    const part = splitDebit(u.credits_plan, u.credits_extra, amount);
    await ledger(userId, -part.plan, "plan", reason, actorId);
    await ledger(userId, -part.extra, "extra", reason, actorId);
    await db.run("UPDATE users SET credits_plan = credits_plan - $2, credits_extra = credits_extra - $3 WHERE id = $1", [
      userId,
      part.plan,
      part.extra,
    ]);
    return u.credits_plan + u.credits_extra - amount;
  });
}

/**
 * Tira créditos de UM saldo por causa de um estorno ou contestação. Nunca deixa
 * o saldo negativo (o que já foi usado não volta) e, com a mesma `ref`, não
 * tira duas vezes. Devolve quanto saiu.
 */
export async function revokeCredits(userId: string, amount: number, bucket: CreditBucket, reason: string, ref: string): Promise<number> {
  if (!(amount > 0)) return 0;
  return tx(async () => {
    const u = await lockUser(userId);
    if (await db.one("SELECT 1 FROM credit_ledger WHERE ref = $1", [ref])) return 0;
    const have = Math.max(0, bucket === "plan" ? u.credits_plan : u.credits_extra);
    // Créditos têm uma casa decimal em passos de meio.
    const taken = Math.min(have, Math.round(amount * 2) / 2);
    // Linha com delta 0 também entra: marca o estorno como processado.
    await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason, ref) VALUES ($1, $2, $3, $4, $5)", [userId, -taken, bucket, reason, ref]);
    if (taken > 0) await db.run(`UPDATE users SET ${bucket === "plan" ? "credits_plan = credits_plan" : "credits_extra = credits_extra"} - $2 WHERE id = $1`, [userId, taken]);
    return taken;
  });
}

/** Ajuste manual pelo painel: positivo entra como crédito extra; negativo é debitado como um consumo. */
export async function adjustCredits(userId: string, delta: number, reason: string, actorId: string) {
  if (delta > 0) await grantCredits(userId, delta, "extra", reason, { actorId });
  else if (delta < 0) await debit(userId, -delta, reason, actorId);
}

/**
 * Administradores usam a plataforma sem consumir créditos: nada é checado nem
 * debitado. O custo real de cada chamada continua registrado em usage_events.
 * Vale só para o papel "admin" — nenhum plano dá créditos ilimitados.
 */
export async function hasUnlimitedCredits(userId: string): Promise<boolean> {
  return (await db.one<{ role: string }>("SELECT role FROM users WHERE id = $1", [userId]))?.role === "admin";
}

/** Falha cedo, antes de gastar com provedores, se o saldo não cobre a ação. */
export async function assertCredits(userId: string, needed: number) {
  if (await hasUnlimitedCredits(userId)) return;
  const have = await balance(userId);
  if (have < needed)
    throw new HttpError(402, `Créditos insuficientes: esta ação custa ${needed} e você tem ${have}.`);
}

/**
 * Cobra uma ação já executada (o provedor já foi pago). Não falha por saldo:
 * a checagem é feita antes com assertCredits; numa corrida rara o saldo pode
 * ficar negativo e bloqueia a próxima ação.
 */
export async function charge(userId: string, amount: number, reason: string): Promise<number> {
  if (amount <= 0 || (await hasUnlimitedCredits(userId))) return balance(userId);
  return debit(userId, amount, reason);
}

/**
 * Renovação: o saldo do plano volta ao valor mensal de `plan` (o que sobrou do
 * ciclo anterior expira; top-ups ficam intactos) e a próxima renovação é
 * agendada para `renewAt`. Com `ref` (fatura do Stripe) é idempotente.
 */
export async function resetPlanCredits(
  userId: string,
  plan: PlanId,
  renewAt: Date,
  opts: { ref?: string; actorId?: string } = {},
): Promise<boolean> {
  return tx(async () => {
    const u = await lockUser(userId);
    if (opts.ref && (await db.one("SELECT 1 FROM credit_ledger WHERE ref = $1", [opts.ref]))) return false;
    const monthly = PLANS[plan].monthlyCredits;
    const next = renewedPlanCredits(u.credits_plan, monthly);
    const expired = Math.max(u.credits_plan, 0);
    const reason = monthly
      ? `renovação do plano ${PLANS[plan].name}: ${monthly} créditos${expired ? ` (${expired} não usados expiraram)` : ""}`
      : `plano ${PLANS[plan].name}: sem créditos mensais${expired ? ` (${expired} do plano anterior expiraram)` : ""}`;
    // delta 0 (saldo já cheio) ainda precisa da linha quando há ref, para marcar a fatura como processada.
    if (next !== u.credits_plan || opts.ref)
      await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason, actor_id, ref) VALUES ($1, $2, 'plan', $3, $4, $5)", [
        userId,
        next - u.credits_plan,
        reason,
        opts.actorId ?? null,
        opts.ref ?? null,
      ]);
    await db.run("UPDATE users SET credits_plan = $2, credits_cycle_grant = $3, credits_renew_at = $4 WHERE id = $1", [
      userId,
      next,
      monthly,
      renewAt.toISOString(),
    ]);
    return true;
  });
}

/**
 * Renovação mensal de quem não tem assinatura no Stripe (plano Free e planos
 * definidos à mão pelo admin). É feita sob demanda, quando a conta é usada
 * depois do vencimento — sem cron. Assinantes renovam pela fatura paga (webhook).
 */
export async function renewIfDue(userId: string): Promise<boolean> {
  return tx(async () => {
    // Revalida sob bloqueio: duas requisições simultâneas renovam uma vez só.
    const u = await db.one<Balances>(
      `SELECT plan, credits_plan, credits_extra, credits_renew_at FROM users
       WHERE id = $1 AND stripe_subscription_id IS NULL AND credits_renew_at <= now() FOR UPDATE`,
      [userId],
    );
    if (!u) return false;
    return resetPlanCredits(userId, u.plan, nextRenewal(new Date(u.credits_renew_at), new Date()));
  });
}

// ---------- Custo real dos provedores (despesas automáticas) ----------

/** US$ por milhão de tokens. Cache write = 1,25× entrada; cache read conforme tabela. */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  // Até 100 mil tokens de prompt por requisição; acima disso, 5× (tratado em anthropicCostUSD).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};

/**
 * Groq: whisper-large-v3-turbo US$ 0,04/h (detecção de idioma) + whisper-large-v3
 * US$ 0,111/h (passe literal). Conta os dois passes no preço do mais caro, com folga.
 */
const GROQ_USD_PER_SECOND = (0.04 + 0.111) / 3600;

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function anthropicCostUSD(model: string, u: TokenUsage): number {
  const key = Object.keys(ANTHROPIC_PRICES).find((k) => model.startsWith(k));
  // Modelo desconhecido: cobra como o mais caro da tabela, para o teto de custo nunca subestimar.
  const p = key ? ANTHROPIC_PRICES[key]! : { input: 8, output: 40, cacheRead: 0.8 };
  // Haiku 5.5 custa 5× acima de 100 mil tokens de prompt (entrada + cache), por requisição.
  const big = key === "claude-haiku-5-5" && u.input + u.cacheRead + u.cacheWrite > 100_000 ? 5 : 1;
  return ((u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead) * big + u.output * p.output * big) / 1e6;
}

export const groqCostUSD = (audioSeconds: number) => audioSeconds * GROQ_USD_PER_SECOND;

export async function recordUsage(e: {
  userId: string | null;
  kind: "agent" | "transcribe" | "template_extract" | "style_reference" | "generate_image" | "generate_video";
  provider: "anthropic" | "groq" | "google";
  model?: string;
  tokens?: TokenUsage;
  audioSeconds?: number;
  costUSD: number;
  credits: number;
}) {
  await db.run(
    `INSERT INTO usage_events (user_id, kind, provider, model, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, audio_seconds, cost_usd, credits) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
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
    ],
  );
}

/** Cotação usada para converter o custo dos provedores (US$) em R$. Editável no painel. */
export async function usdToBrl(): Promise<number> {
  const v = Number(await getSetting("USD_BRL"));
  return Number.isFinite(v) && v > 0 ? v : 5.4;
}
