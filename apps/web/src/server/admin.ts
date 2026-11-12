import "server-only";
import { PLANS, type PlanId } from "@videoeditor/core";
import { db, now, tx } from "./db";
import { addCredits, usdToBrl } from "./billing";
import { getUser, HttpError, logAdmin, type Role, type User } from "./users";

export type UserRow = User & { credits: number; spent_credits: number; cost_usd: number; paid_brl: number };

export function listUsers(opts: { q?: string; filter?: "all" | "banned" | "admins"; limit?: number; offset?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.q) {
    where.push("(u.email LIKE ? OR u.name LIKE ?)");
    args.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.filter === "banned") where.push("u.banned_at IS NOT NULL");
  if (opts.filter === "admins") where.push("u.role = 'admin'");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db().prepare(`SELECT COUNT(*) AS n FROM users u ${clause}`).get(...args) as { n: number }).n;
  const rows = db()
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.banned_at, u.ban_reason, u.created_at, u.last_seen_at,
        COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE user_id = u.id), 0) AS credits,
        COALESCE((SELECT -SUM(delta) FROM credit_ledger WHERE user_id = u.id AND delta < 0), 0) AS spent_credits,
        COALESCE((SELECT SUM(cost_usd) FROM usage_events WHERE user_id = u.id), 0) AS cost_usd,
        COALESCE((SELECT SUM(amount_brl) FROM payments WHERE user_id = u.id), 0) AS paid_brl
       FROM users u ${clause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, opts.limit ?? 50, opts.offset ?? 0) as UserRow[];
  return { total, users: rows };
}

export function userDetail(id: string) {
  const user = getUser(id);
  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  const ledger = db()
    .prepare("SELECT delta, reason, actor_id, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30")
    .all(id);
  const usage = db()
    .prepare(
      "SELECT kind, model, cost_usd, credits, created_at FROM usage_events WHERE user_id = ? ORDER BY id DESC LIMIT 30",
    )
    .all(id);
  const payments = db()
    .prepare("SELECT amount_brl, description, paid_at FROM payments WHERE user_id = ? ORDER BY paid_at DESC LIMIT 30")
    .all(id);
  return { user, ledger, usage, payments };
}

/** Ações do painel sobre um usuário. Cada uma vai para o log de auditoria. */
export type UserAction =
  | { action: "ban"; reason?: string }
  | { action: "unban" }
  | { action: "grant_credits"; amount: number; reason?: string }
  | { action: "set_plan"; plan: PlanId; grantCredits: boolean; paymentBRL?: number }
  | { action: "set_role"; role: Role };

export function applyUserAction(actor: User, targetId: string, a: UserAction) {
  const target = getUser(targetId);
  if (!target) throw new HttpError(404, "Usuário não encontrado.");
  const self = actor.id === target.id;
  tx(() => {
    switch (a.action) {
      case "ban":
        if (self) throw new HttpError(400, "Você não pode suspender a própria conta.");
        db()
          .prepare("UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?")
          .run(now(), a.reason?.trim() || null, target.id);
        // Derruba as sessões abertas na hora.
        db().prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
        break;
      case "unban":
        db().prepare("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?").run(target.id);
        break;
      case "grant_credits":
        if (!Number.isInteger(a.amount) || a.amount === 0) throw new HttpError(400, "Informe uma quantidade inteira diferente de zero.");
        addCredits(target.id, a.amount, a.reason?.trim() || (a.amount > 0 ? "créditos concedidos pelo admin" : "ajuste pelo admin"), actor.id);
        break;
      case "set_plan": {
        const plan = PLANS[a.plan];
        if (!plan) throw new HttpError(400, "Plano inválido.");
        db().prepare("UPDATE users SET plan = ? WHERE id = ?").run(a.plan, target.id);
        if (a.grantCredits && plan.monthlyCredits > 0)
          addCredits(target.id, plan.monthlyCredits, `créditos do plano ${plan.name}`, actor.id);
        if (a.paymentBRL && a.paymentBRL > 0)
          recordPayment(actor.id, { userId: target.id, amountBRL: a.paymentBRL, description: `Plano ${plan.name}`, paidAt: now() });
        break;
      }
      case "set_role":
        if (self && a.role !== "admin") throw new HttpError(400, "Você não pode remover o próprio acesso de admin.");
        db().prepare("UPDATE users SET role = ? WHERE id = ?").run(a.role, target.id);
        break;
    }
    logAdmin(actor.id, a.action, target.id, a);
  });
  return getUser(target.id)!;
}

// ---------- Financeiro ----------

export function recordPayment(
  actorId: string,
  p: { userId: string | null; amountBRL: number; description: string; paidAt: string },
) {
  db()
    .prepare(
      "INSERT INTO payments (user_id, amount_brl, description, source, actor_id, paid_at, created_at) VALUES (?, ?, ?, 'manual', ?, ?, ?)",
    )
    .run(p.userId, p.amountBRL, p.description, actorId, p.paidAt, now());
}

export function recordExpense(actorId: string, e: { category: string; description: string; amountBRL: number; spentAt: string }) {
  db()
    .prepare(
      "INSERT INTO expenses (category, description, amount_brl, actor_id, spent_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(e.category, e.description, e.amountBRL, actorId, e.spentAt, now());
}

export function deleteFinanceEntry(actorId: string, kind: "payment" | "expense", id: number) {
  db().prepare(`DELETE FROM ${kind === "payment" ? "payments" : "expenses"} WHERE id = ?`).run(id);
  logAdmin(actorId, `delete_${kind}`, String(id));
}

/**
 * Resumo financeiro de um período [from, to). Despesas = custo real de IA
 * (US$ → R$ pela cotação configurada) + despesas lançadas à mão.
 */
export function financeSummary(from: string, to: string) {
  const rate = usdToBrl();
  const revenue = (db().prepare("SELECT COALESCE(SUM(amount_brl), 0) AS v FROM payments WHERE paid_at >= ? AND paid_at < ?").get(from, to) as { v: number }).v;
  const manual = (db().prepare("SELECT COALESCE(SUM(amount_brl), 0) AS v FROM expenses WHERE spent_at >= ? AND spent_at < ?").get(from, to) as { v: number }).v;
  const aiByProvider = db()
    .prepare(
      `SELECT provider, kind, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd, SUM(credits) AS credits
       FROM usage_events WHERE created_at >= ? AND created_at < ? GROUP BY provider, kind ORDER BY cost_usd DESC`,
    )
    .all(from, to) as { provider: string; kind: string; calls: number; cost_usd: number; credits: number }[];
  const aiUSD = aiByProvider.reduce((s, r) => s + r.cost_usd, 0);
  const aiBRL = aiUSD * rate;

  // Série mensal dos últimos 12 meses (sempre, independente do filtro).
  const months: { month: string; revenue: number; expenses: number }[] = [];
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  for (let i = 11; i >= 0; i--) {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1));
    const [s, e] = [start.toISOString(), end.toISOString()];
    const rev = (db().prepare("SELECT COALESCE(SUM(amount_brl), 0) AS v FROM payments WHERE paid_at >= ? AND paid_at < ?").get(s, e) as { v: number }).v;
    const man = (db().prepare("SELECT COALESCE(SUM(amount_brl), 0) AS v FROM expenses WHERE spent_at >= ? AND spent_at < ?").get(s, e) as { v: number }).v;
    const ai = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS v FROM usage_events WHERE created_at >= ? AND created_at < ?").get(s, e) as { v: number }).v;
    months.push({ month: s.slice(0, 7), revenue: rev, expenses: man + ai * rate });
  }

  const payments = db()
    .prepare(
      `SELECT p.id, p.amount_brl, p.description, p.paid_at, u.email AS user_email
       FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.paid_at >= ? AND p.paid_at < ? ORDER BY p.paid_at DESC LIMIT 100`,
    )
    .all(from, to);
  const expenses = db()
    .prepare("SELECT id, category, description, amount_brl, spent_at FROM expenses WHERE spent_at >= ? AND spent_at < ? ORDER BY spent_at DESC LIMIT 100")
    .all(from, to);

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

export function overview() {
  const count = (sql: string, ...args: string[]) => (db().prepare(sql).get(...args) as { n: number }).n;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const byPlan = db().prepare("SELECT plan, COUNT(*) AS n FROM users GROUP BY plan").all() as { plan: string; n: number }[];
  const mrr = byPlan.reduce((s, r) => s + (PLANS[r.plan as PlanId]?.priceBRL ?? 0) * r.n, 0);
  const recent = db()
    .prepare("SELECT id, email, name, plan, created_at FROM users ORDER BY created_at DESC LIMIT 5")
    .all();
  const log = db()
    .prepare(
      `SELECT l.action, l.target, l.created_at, a.email AS actor_email, t.email AS target_email
       FROM admin_log l LEFT JOIN users a ON a.id = l.actor_id LEFT JOIN users t ON t.id = l.target
       ORDER BY l.id DESC LIMIT 10`,
    )
    .all();
  return {
    users: count("SELECT COUNT(*) AS n FROM users"),
    active30: count("SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?", since30),
    banned: count("SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL"),
    newThisMonth: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", monthStart.toISOString()),
    byPlan,
    mrrBRL: mrr,
    templates: count("SELECT COUNT(*) AS n FROM templates WHERE status = 'published'"),
    // Até o início do mês seguinte: lançamentos datados de hoje (meio-dia UTC) entram mesmo antes desse horário.
    month: financeSummary(
      monthStart.toISOString(),
      new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)).toISOString(),
    ),
    recent,
    log,
  };
}
