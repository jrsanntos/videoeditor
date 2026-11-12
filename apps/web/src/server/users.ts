import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { PLANS, type PlanId } from "@videoeditor/core";
import { renewIfDue } from "./billing";
import { db, tx } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { HttpError } from "./errors";

export { errorResponse, HttpError } from "./errors";

export type Role = "user" | "admin";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  plan: PlanId;
  credits_plan: number;
  credits_extra: number;
  credits_renew_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  subscription_period_end: string | null;
  subscription_cancel_at_period_end: boolean;
  banned_at: string | null;
  ban_reason: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export const SESSION_COOKIE = "ve_session";
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const COLS = [
  "id",
  "email",
  "name",
  "role",
  "plan",
  "credits_plan",
  "credits_extra",
  "credits_renew_at",
  "stripe_customer_id",
  "stripe_subscription_id",
  "subscription_status",
  "subscription_period_end",
  "subscription_cancel_at_period_end",
  "banned_at",
  "ban_reason",
  "created_at",
  "last_seen_at",
];
export const USER_COLS = COLS.join(", ");
const USER_COLS_U = COLS.map((c) => `u.${c}`).join(", ");

/** E-mails em ADMIN_EMAILS (separados por vírgula) viram admin ao se cadastrar ou entrar. */
const adminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export async function getUser(id: string): Promise<User | null> {
  return (await db.one<User>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id])) ?? null;
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  return (await db.one<{ id: string }>("SELECT id FROM users WHERE email = $1", [normalizeEmail(email)]))?.id ?? null;
}

export async function createUser(input: { email: string; name: string; password: string }): Promise<User> {
  const email = normalizeEmail(input.email);
  // Fora da transação: o hash leva dezenas de ms e não deve segurar uma conexão.
  const passwordHash = await hashPassword(input.password);
  return tx(async () => {
    // Em desenvolvimento, sem ADMIN_EMAILS e sem nenhum admin, a primeira conta assume o painel.
    // Em produção só ADMIN_EMAILS cria admins: ninguém "chega primeiro" num deploy público.
    const bootstrap =
      process.env.NODE_ENV !== "production" &&
      adminEmails().size === 0 &&
      !(await db.one("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"));
    const role: Role = adminEmails().has(email) || bootstrap ? "admin" : "user";
    const credits = PLANS.free.monthlyCredits;
    // A unicidade é garantida pelo índice: sem corrida entre "existe?" e o insert.
    const user = await db.one<User>(
      `INSERT INTO users (id, email, name, password_hash, role, plan, credits_plan, credits_cycle_grant, credits_renew_at)
       VALUES ($1, $2, $3, $4, $5, 'free', $6, $6, now() + interval '1 month')
       ON CONFLICT (email) DO NOTHING RETURNING ${USER_COLS}`,
      [`usr_${crypto.randomUUID()}`, email, input.name.trim(), passwordHash, role, credits],
    );
    if (!user) throw new HttpError(409, "Já existe uma conta com este e-mail.");
    await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason) VALUES ($1, $2, 'plan', $3)", [
      user.id,
      credits,
      "créditos do plano Free (cadastro)",
    ]);
    return user;
  });
}

// Hash de referência para gastar o mesmo tempo quando o e-mail não existe
// (a resposta não revela, pela demora, quais e-mails têm conta).
let dummyHash: Promise<string> | undefined;

export async function verifyLogin(emailRaw: string, password: string): Promise<User> {
  const row = await db.one<User & { password_hash: string }>(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = $1`, [
    normalizeEmail(emailRaw),
  ]);
  const ok = await verifyPassword(password, row?.password_hash ?? (await (dummyHash ??= hashPassword(randomToken()))));
  if (!row || !ok) throw new HttpError(401, "E-mail ou senha incorretos.");
  if (row.banned_at) throw new HttpError(403, bannedMessage(row));
  if (row.role !== "admin" && adminEmails().has(row.email)) {
    await db.run("UPDATE users SET role = 'admin' WHERE id = $1", [row.id]);
    row.role = "admin";
  }
  const { password_hash: _, ...user } = row;
  return user;
}

export const bannedMessage = (u: Pick<User, "ban_reason">) =>
  `Esta conta foi suspensa${u.ban_reason ? `: ${u.ban_reason}` : ""}. Fale com o suporte.`;

export async function startSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    sha256(token),
    userId,
    expires.toISOString(),
  ]);
  // Limpeza oportunista de sessões e pedidos de redefinição vencidos.
  if (Math.random() < 0.05) {
    void db.run("DELETE FROM sessions WHERE expires_at < now()").catch(() => {});
    void db.run("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'").catch(() => {});
  }
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.run("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

/** Usuário da sessão atual, ou null. Contas suspensas não têm sessão válida. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await db.one<User>(
    `SELECT ${USER_COLS_U} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.banned_at IS NULL`,
    [sha256(token)],
  );
  if (!user) return null;
  // last_seen com granularidade de minutos: evita escrita a cada requisição.
  if (!user.last_seen_at || Date.now() - Date.parse(user.last_seen_at) > 60_000)
    await db.run("UPDATE users SET last_seen_at = now() WHERE id = $1", [user.id]);
  // Renovação mensal sob demanda para quem não é cobrado pelo Stripe.
  if (!user.stripe_subscription_id && Date.parse(user.credits_renew_at) <= Date.now() && (await renewIfDue(user.id)))
    return getUser(user.id);
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Entre na sua conta para continuar.");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") throw new HttpError(403, "Acesso restrito a administradores.");
  return user;
}

// ---------- Recuperação de senha ----------

/**
 * Cria um pedido de redefinição e devolve o token (só o hash vai para o banco).
 * Devolve null quando não há conta ativa com o e-mail — quem chama responde
 * igual nos dois casos, para não revelar quais e-mails têm conta.
 */
export async function createPasswordReset(emailRaw: string): Promise<{ user: Pick<User, "id" | "email" | "name">; token: string } | null> {
  const user = await db.one<Pick<User, "id" | "email" | "name">>(
    "SELECT id, email, name FROM users WHERE email = $1 AND banned_at IS NULL",
    [normalizeEmail(emailRaw)],
  );
  if (!user) return null;
  const token = randomToken();
  await tx(async () => {
    // Só o link mais recente vale.
    await db.run("DELETE FROM password_resets WHERE user_id = $1", [user.id]);
    await db.run("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))", [
      sha256(token),
      user.id,
      RESET_MINUTES,
    ]);
  });
  return { user, token };
}

export const RESET_LINK_MINUTES = RESET_MINUTES;

/** Troca a senha com um token válido (uso único) e encerra todas as sessões da conta. */
export async function resetPassword(token: string, password: string) {
  const passwordHash = await hashPassword(password);
  await tx(async () => {
    // O UPDATE condicional consome o token de forma atômica: dois usos simultâneos, só um passa.
    const reset = await db.one<{ user_id: string }>(
      "UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id",
      [sha256(token)],
    );
    if (!reset) throw new HttpError(400, "Este link expirou ou já foi usado. Peça um novo.");
    await db.run("UPDATE users SET password_hash = $2 WHERE id = $1", [reset.user_id, passwordHash]);
    await db.run("DELETE FROM sessions WHERE user_id = $1", [reset.user_id]);
  });
}

export async function logAdmin(actorId: string, action: string, target?: string, detail?: unknown) {
  await db.run("INSERT INTO admin_log (actor_id, action, target, detail) VALUES ($1, $2, $3, $4)", [
    actorId,
    action,
    target ?? null,
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}
