import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { SIGNUP_CREDITS, type PlanId } from "@videoeditor/core";
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

/**
 * Cria a conta. Com `verified: false` ela nasce pendente: só entra depois de
 * confirmar o e-mail. Um novo cadastro com o e-mail de uma conta ainda
 * pendente assume a conta (nome e senha novos) — quem confirma o e-mail é o
 * dono, e ninguém consegue "reservar" o e-mail de outra pessoa com a própria senha.
 */
export async function createUser(input: { email: string; name: string; password: string }, opts: { verified: boolean } = { verified: true }): Promise<User> {
  const email = normalizeEmail(input.email);
  // Fora da transação: o hash leva dezenas de ms e não deve segurar uma conexão.
  const passwordHash = await hashPassword(input.password);
  return tx(async () => {
    const pending = await db.one<User>(
      `UPDATE users SET name = $2, password_hash = $3 WHERE email = $1 AND email_verified_at IS NULL AND banned_at IS NULL RETURNING ${USER_COLS}`,
      [email, input.name.trim(), passwordHash],
    );
    if (pending) {
      await db.run("DELETE FROM sessions WHERE user_id = $1", [pending.id]);
      if (opts.verified) await db.run("UPDATE users SET email_verified_at = now() WHERE id = $1", [pending.id]);
      return pending;
    }
    // Em desenvolvimento, sem ADMIN_EMAILS e sem nenhum admin, a primeira conta assume o painel.
    // Em produção só ADMIN_EMAILS cria admins: ninguém "chega primeiro" num deploy público.
    const bootstrap =
      process.env.NODE_ENV !== "production" &&
      adminEmails().size === 0 &&
      !(await db.one("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"));
    const role: Role = adminEmails().has(email) || bootstrap ? "admin" : "user";
    // Créditos de boas-vindas: uma vez só, no saldo extra (não expiram nem renovam).
    const credits = SIGNUP_CREDITS;
    // A unicidade é garantida pelo índice: sem corrida entre "existe?" e o insert.
    const user = await db.one<User>(
      `INSERT INTO users (id, email, name, password_hash, role, plan, credits_plan, credits_cycle_grant, credits_renew_at, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, 'free', 0, 0, now() + interval '1 month', CASE WHEN $6 THEN now() END)
       ON CONFLICT (email) DO NOTHING RETURNING ${USER_COLS}`,
      [`usr_${crypto.randomUUID()}`, email, input.name.trim(), passwordHash, role, opts.verified],
    );
    if (!user) throw new HttpError(409, "Já existe uma conta com este e-mail.");
    await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason) VALUES ($1, $2, 'extra', $3)", [
      user.id,
      credits,
      "créditos de boas-vindas (cadastro)",
    ]);
    await db.run("UPDATE users SET credits_extra = $2 WHERE id = $1", [user.id, credits]);
    return { ...user, credits_extra: credits };
  });
}

/**
 * Entrada pelo Google, com a identidade já conferida (e-mail verificado pelo
 * Google). Três casos:
 * - a conta Google já está ligada a um usuário: entra;
 * - há uma conta com o mesmo e-mail: liga o Google a ela. Se essa conta ainda
 *   estava pendente de confirmação, a senha dela é descartada — quem provou
 *   ser dono do e-mail foi o Google, não quem cadastrou a senha;
 * - não há conta: cria uma, sem senha, com os créditos de boas-vindas.
 * Devolve o usuário e se a conta acabou de ser criada.
 */
export async function signInWithGoogle(input: { sub: string; email: string; name: string }): Promise<{ user: User; created: boolean }> {
  const email = normalizeEmail(input.email);
  const name = (input.name.trim() || email.split("@")[0] || "Criador").slice(0, 80);
  const result = await tx(async () => {
    const linked = await db.one<User>(`SELECT ${USER_COLS} FROM users WHERE google_sub = $1`, [input.sub]);
    if (linked) return { user: linked, created: false };
    const existing = await db.one<User & { email_verified_at: string | null }>(`SELECT ${USER_COLS}, email_verified_at FROM users WHERE email = $1 FOR UPDATE`, [email]);
    if (existing) {
      const pending = !existing.email_verified_at;
      await db.run(
        `UPDATE users SET google_sub = $2, email_verified_at = COALESCE(email_verified_at, now())${pending ? ", password_hash = NULL" : ""} WHERE id = $1`,
        [existing.id, input.sub],
      );
      if (pending) await db.run("DELETE FROM sessions WHERE user_id = $1", [existing.id]);
      const { email_verified_at: _, ...user } = existing;
      return { user, created: false };
    }
    const bootstrap =
      process.env.NODE_ENV !== "production" &&
      adminEmails().size === 0 &&
      !(await db.one("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1"));
    const role: Role = adminEmails().has(email) || bootstrap ? "admin" : "user";
    const user = await db.one<User>(
      `INSERT INTO users (id, email, name, password_hash, google_sub, role, plan, credits_plan, credits_cycle_grant, credits_renew_at, email_verified_at)
       VALUES ($1, $2, $3, NULL, $4, $5, 'free', 0, 0, now() + interval '1 month', now())
       RETURNING ${USER_COLS}`,
      [`usr_${crypto.randomUUID()}`, email, name, input.sub, role],
    );
    if (!user) throw new HttpError(500, "Não foi possível criar a conta.");
    await db.run("INSERT INTO credit_ledger (user_id, delta, bucket, reason) VALUES ($1, $2, 'extra', $3)", [user.id, SIGNUP_CREDITS, "créditos de boas-vindas (cadastro)"]);
    await db.run("UPDATE users SET credits_extra = $2 WHERE id = $1", [user.id, SIGNUP_CREDITS]);
    return { user: { ...user, credits_extra: SIGNUP_CREDITS }, created: true };
  });
  if (result.user.banned_at) throw new HttpError(403, bannedMessage(result.user));
  if (result.user.role !== "admin" && adminEmails().has(result.user.email)) {
    await db.run("UPDATE users SET role = 'admin' WHERE id = $1", [result.user.id]);
    result.user.role = "admin";
  }
  return result;
}

// Hash de referência para gastar o mesmo tempo quando o e-mail não existe
// (a resposta não revela, pela demora, quais e-mails têm conta).
let dummyHash: Promise<string> | undefined;

export async function verifyLogin(emailRaw: string, password: string): Promise<User> {
  const row = await db.one<User & { password_hash: string | null; email_verified_at: string | null }>(`SELECT ${USER_COLS}, password_hash, email_verified_at FROM users WHERE email = $1`, [
    normalizeEmail(emailRaw),
  ]);
  const ok = await verifyPassword(password, row?.password_hash ?? (await (dummyHash ??= hashPassword(randomToken()))));
  if (!row || !ok) throw new HttpError(401, "E-mail ou senha incorretos.");
  if (row.banned_at) throw new HttpError(403, bannedMessage(row));
  // Só depois de conferir a senha: a resposta não revela a quem não é o dono que a conta existe.
  if (!row.email_verified_at) throw new HttpError(403, "Confirme seu e-mail para entrar: enviamos um link quando você criou a conta.", undefined, "email_unverified");
  if (row.role !== "admin" && adminEmails().has(row.email)) {
    await db.run("UPDATE users SET role = 'admin' WHERE id = $1", [row.id]);
    row.role = "admin";
  }
  const { password_hash: _, email_verified_at: __, ...user } = row;
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

// ---------- Confirmação de e-mail ----------

const VERIFY_HOURS = 24;
export const VERIFY_LINK_HOURS = VERIFY_HOURS;

/** Gera o token do link de confirmação (só o hash vai para o banco). O link mais recente é o que vale. */
export async function createEmailVerification(userId: string): Promise<string> {
  const token = randomToken();
  await tx(async () => {
    await db.run("DELETE FROM email_verifications WHERE user_id = $1", [userId]);
    await db.run("INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))", [sha256(token), userId, VERIFY_HOURS]);
  });
  if (Math.random() < 0.05) void db.run("DELETE FROM email_verifications WHERE expires_at < now()").catch(() => {});
  return token;
}

/** Conta ainda não confirmada com este e-mail, ou null. */
export async function findUnverified(emailRaw: string): Promise<Pick<User, "id" | "email" | "name"> | null> {
  return (
    (await db.one<Pick<User, "id" | "email" | "name">>("SELECT id, email, name FROM users WHERE email = $1 AND email_verified_at IS NULL AND banned_at IS NULL", [
      normalizeEmail(emailRaw),
    ])) ?? null
  );
}

/** Confirma o e-mail com o token do link (uso único). Devolve o id da conta, ou null se o link não vale mais. */
export async function verifyEmail(token: string): Promise<string | null> {
  return tx(async () => {
    const row = await db.one<{ user_id: string }>("DELETE FROM email_verifications WHERE token_hash = $1 AND expires_at > now() RETURNING user_id", [sha256(token)]);
    if (!row) return null;
    await db.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [row.user_id]);
    return row.user_id;
  });
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
    // Quem abriu o link de redefinição provou que o e-mail é seu.
    await db.run("UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [reset.user_id, passwordHash]);
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
