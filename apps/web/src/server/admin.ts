import "server-only";
import { PLANS, type PlanId } from "@videoeditor/core";
import { db, tx } from "./db";
import { adjustCredits, resetPlanCredits, usdToBrl } from "./billing";
import { getUser, HttpError, logAdmin, USER_COLS, type Role, type User } from "./users";

export type UserRow = User & { credits: number; spent_credits: number; cost_usd: number; paid_brl: number };

const USER_COLS_U = USER_COLS.split(", ")
  .map((c) => `u.${c}`)
  .join(", ");

export async function listUsers(opts: { q?: string; filter?: "all" | "banned" | "admins"; limit?: number; offset?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.q) {
    // Curingas digitados na busca são tratados como texto.
    args.push(`%${opts.q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(u.email ILIKE $${args.length} OR u.name ILIKE $${args.length})`);
  }
  if (opts.filter === "banned") where.push("u.banned_at IS NOT NULL");
  if (opts.filter === "admins") where.push("u.role = 'admin'");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [count, users] = await Promise.all([
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM users u ${clause}`, args),
    // Os agregados rodam só para as linhas da página (LATERAL depois do LIMIT), cada um por índice.
    db.query<UserRow>(
      `SELECT p.*, p.credits_plan + p.credits_extra AS credits, used.credits AS spent_credits, used.cost AS cost_usd, paid.v AS paid_brl
       FROM (SELECT ${USER_COLS_U} FROM users u ${clause} ORDER BY u.created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}) p
       CROSS JOIN LATERAL (SELECT COALESCE(SUM(credits), 0) AS credits, COALESCE(SUM(cost_usd), 0) AS cost FROM usage_events WHERE user_id = p.id) used
       CROSS JOIN LATERAL (SELECT COALESCE(SUM(amount_brl), 0) AS v FROM payments WHERE user_id = p.id) paid
       ORDER BY p.created_at DESC`,
      [...args, opts.limit ?? 50, opts.offset ?? 0],
    ),
  ]);
  return { total: count?.n ?? 0, users };
}

export async function userDetail(id: string) {
  const user = await getUser(id);
  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  const [ledger, usage, payments] = await Promise.all([
    db.query("SELECT delta, bucket, reason, actor_id, created_at FROM credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30", [id]),
    db.query("SELECT kind, model, cost_usd, credits, created_at FROM usage_events WHERE user_id = $1 ORDER BY id DESC LIMIT 30", [id]),
    db.query("SELECT amount_brl, description, source, paid_at FROM payments WHERE user_id = $1 ORDER BY paid_at DESC LIMIT 30", [id]),
  ]);
  return { user, ledger, usage, payments };
}

/** Ações do painel sobre um usuário. Cada uma vai para o log de auditoria. */
export type UserAction =
  | { action: "ban"; reason?: string }
  | { action: "unban" }
  | { action: "grant_credits"; amount: number; reason?: string }
  | { action: "set_plan"; plan: PlanId; grantCredits: boolean; paymentBRL?: number }
  | { action: "set_role"; role: Role };

export async function applyUserAction(actor: User, targetId: string, a: UserAction) {
  const target = await getUser(targetId);
  if (!target) throw new HttpError(404, "Usuário não encontrado.");
  const self = actor.id === target.id;
  await tx(async () => {
    switch (a.action) {
      case "ban":
        if (self) throw new HttpError(400, "Você não pode suspender a própria conta.");
        await db.run("UPDATE users SET banned_at = now(), ban_reason = $2 WHERE id = $1", [target.id, a.reason?.trim() || null]);
        // Derruba as sessões abertas na hora.
        await db.run("DELETE FROM sessions WHERE user_id = $1", [target.id]);
        break;
      case "unban":
        await db.run("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1", [target.id]);
        break;
      case "grant_credits":
        if (!Number.isInteger(a.amount) || a.amount === 0) throw new HttpError(400, "Informe uma quantidade inteira diferente de zero.");
        await adjustCredits(target.id, a.amount, a.reason?.trim() || (a.amount > 0 ? "créditos concedidos pelo admin" : "ajuste pelo admin"), actor.id);
        break;
      case "set_plan": {
        const plan = PLANS[a.plan];
        if (!plan) throw new HttpError(400, "Plano inválido.");
        // Com assinatura ativa no Stripe, o plano segue a assinatura: o próximo webhook desfaria a troca.
        if (target.stripe_subscription_id && a.plan !== target.plan)
          throw new HttpError(409, "Esta conta tem assinatura ativa no Stripe. Altere ou cancele a assinatura por lá.");
        await db.run("UPDATE users SET plan = $2 WHERE id = $1", [target.id, a.plan]);
        if (a.grantCredits)
          await resetPlanCredits(target.id, a.plan, new Date(Date.now() + 30 * 86400_000), { actorId: actor.id });
        if (a.paymentBRL && a.paymentBRL > 0)
          await recordPayment(actor.id, { userId: target.id, amountBRL: a.paymentBRL, description: `Plano ${plan.name}`, paidAt: new Date().toISOString() });
        break;
      }
      case "set_role":
        if (self && a.role !== "admin") throw new HttpError(400, "Você não pode remover o próprio acesso de admin.");
        await db.run("UPDATE users SET role = $2 WHERE id = $1", [target.id, a.role]);
        break;
    }
    await logAdmin(actor.id, a.action, target.id, a);
  });
  return (await getUser(target.id))!;
}

// ---------- Financeiro ----------

export async function recordPayment(
  actorId: string,
  p: { userId: string | null; amountBRL: number; description: string; paidAt: string },
) {
  await db.run("INSERT INTO payments (user_id, amount_brl, description, source, actor_id, paid_at) VALUES ($1, $2, $3, 'manual', $4, $5)", [
    p.userId,
    p.amountBRL,
    p.description,
    actorId,
    p.paidAt,
  ]);
}

export async function recordExpense(actorId: string, e: { category: string; description: string; amountBRL: number; spentAt: string }) {
  await db.run("INSERT INTO expenses (category, description, amount_brl, actor_id, spent_at) VALUES ($1, $2, $3, $4, $5)", [
    e.category,
    e.description,
    e.amountBRL,
    actorId,
    e.spentAt,
  ]);
}

export async function deleteFinanceEntry(actorId: string, kind: "payment" | "expense", id: number) {
  await db.run(`DELETE FROM ${kind === "payment" ? "payments" : "expenses"} WHERE id = $1`, [id]);
  await logAdmin(actorId, `delete_${kind}`, String(id));
}

/**
 * Resumo financeiro de um período [from, to). Despesas = custo real de IA
 * (US$ → R$ pela cotação configurada) + despesas lançadas à mão.
 */
export async function financeSummary(from: string, to: string) {
  // Série mensal dos últimos 12 meses (sempre, independente do filtro), em UTC.
  const today = new Date();
  const starts: string[] = [];
  const ends: string[] = [];
  for (let i = 11; i >= 0; i--) {
    starts.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString());
    ends.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i + 1, 1)).toISOString());
  }

  const [rate, totals, aiByProvider, series, payments, expenses] = await Promise.all([
    usdToBrl(),
    db.one<{ revenue: number; manual: number }>(
      `SELECT (SELECT COALESCE(SUM(amount_brl), 0) FROM payments WHERE paid_at >= $1 AND paid_at < $2) AS revenue,
              (SELECT COALESCE(SUM(amount_brl), 0) FROM expenses WHERE spent_at >= $1 AND spent_at < $2) AS manual`,
      [from, to],
    ),
    db.query<{ provider: string; kind: string; calls: number; cost_usd: number; credits: number }>(
      `SELECT provider, kind, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd, SUM(credits) AS credits
       FROM usage_events WHERE created_at >= $1 AND created_at < $2 GROUP BY provider, kind ORDER BY cost_usd DESC`,
      [from, to],
    ),
    // Os 12 meses numa única consulta (antes eram 36).
    db.query<{ idx: number; revenue: number; manual: number; ai_usd: number }>(
      `SELECT m.idx,
        (SELECT COALESCE(SUM(amount_brl), 0) FROM payments WHERE paid_at >= m.s AND paid_at < m.e) AS revenue,
        (SELECT COALESCE(SUM(amount_brl), 0) FROM expenses WHERE spent_at >= m.s AND spent_at < m.e) AS manual,
        (SELECT COALESCE(SUM(cost_usd), 0) FROM usage_events WHERE created_at >= m.s AND created_at < m.e) AS ai_usd
       FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS m(s, e, idx) ORDER BY m.idx`,
      [starts, ends],
    ),
    db.query(
      `SELECT p.id, p.amount_brl, p.description, p.source, p.paid_at, u.email AS user_email
       FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.paid_at >= $1 AND p.paid_at < $2 ORDER BY p.paid_at DESC LIMIT 100`,
      [from, to],
    ),
    db.query("SELECT id, category, description, amount_brl, spent_at FROM expenses WHERE spent_at >= $1 AND spent_at < $2 ORDER BY spent_at DESC LIMIT 100", [
      from,
      to,
    ]),
  ]);

  const revenue = totals?.revenue ?? 0;
  const manual = totals?.manual ?? 0;
  const aiUSD = aiByProvider.reduce((s, r) => s + r.cost_usd, 0);
  const aiBRL = aiUSD * rate;
  const months = series.map((r) => ({
    month: starts[r.idx - 1]!.slice(0, 7),
    revenue: r.revenue,
    expenses: r.manual + r.ai_usd * rate,
  }));

  return {
    rate,
    revenue,
    expenses: { total: manual + aiBRL, manual, aiBRL, aiUSD, aiByProvider },
    profit: revenue - manual - aiBRL,
    months,
    payments,
    expenseEntries: expenses,
  };
}

export async function overview() {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [counts, byPlan, templates, recent, log, month] = await Promise.all([
    // Um único passe pela tabela para todos os contadores.
    db.one<{ users: number; active30: number; banned: number; new_this_month: number }>(
      `SELECT COUNT(*) AS users,
              COUNT(*) FILTER (WHERE last_seen_at >= $1) AS active30,
              COUNT(*) FILTER (WHERE banned_at IS NOT NULL) AS banned,
              COUNT(*) FILTER (WHERE created_at >= $2) AS new_this_month
       FROM users`,
      [since30, monthStart.toISOString()],
    ),
    db.query<{ plan: string; n: number }>("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan"),
    db.one<{ n: number }>("SELECT COUNT(*) AS n FROM templates WHERE status = 'published'"),
    db.query("SELECT id, email, name, plan, created_at FROM users ORDER BY created_at DESC LIMIT 5"),
    db.query(
      `SELECT l.action, l.target, l.created_at, a.email AS actor_email, t.email AS target_email
       FROM admin_log l LEFT JOIN users a ON a.id = l.actor_id LEFT JOIN users t ON t.id = l.target
       ORDER BY l.id DESC LIMIT 10`,
    ),
    // Até o início do mês seguinte: lançamentos datados de hoje (meio-dia UTC) entram mesmo antes desse horário.
    financeSummary(monthStart.toISOString(), new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)).toISOString()),
  ]);
  return {
    users: counts?.users ?? 0,
    active30: counts?.active30 ?? 0,
    banned: counts?.banned ?? 0,
    newThisMonth: counts?.new_this_month ?? 0,
    byPlan,
    mrrBRL: byPlan.reduce((s, r) => s + (PLANS[r.plan as PlanId]?.priceBRL ?? 0) * r.n, 0),
    templates: templates?.n ?? 0,
    month,
    recent,
    log,
  };
}
