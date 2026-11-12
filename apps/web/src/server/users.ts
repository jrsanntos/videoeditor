import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { PLANS, type PlanId } from "@videoeditor/core";
import { db, now, tx } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";

export type Role = "user" | "admin";
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  plan: PlanId;
  banned_at: string | null;
  ban_reason: string | null;
  created_at: string;
  last_seen_at: string | null;
};

export const SESSION_COOKIE = "ve_session";
const SESSION_DAYS = 30;
const USER_COLS = "id, email, name, role, plan, banned_at, ban_reason, created_at, last_seen_at";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** E-mails em ADMIN_EMAILS (separados por vírgula) viram admin ao se cadastrar ou entrar. */
const adminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export function getUser(id: string): User | null {
  return (db().prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as User | undefined) ?? null;
}

export function createUser(input: { email: string; name: string; password: string }): User {
  const email = normalizeEmail(input.email);
  return tx(() => {
    if (db().prepare("SELECT 1 FROM users WHERE email = ?").get(email))
      throw new HttpError(409, "Já existe uma conta com este e-mail.");
    const id = `usr_${crypto.randomUUID()}`;
    // Em desenvolvimento, sem ADMIN_EMAILS e sem nenhum admin, a primeira conta assume o painel.
    // Em produção só ADMIN_EMAILS cria admins: ninguém "chega primeiro" num deploy público.
    const bootstrap =
      process.env.NODE_ENV !== "production" &&
      adminEmails().size === 0 &&
      !db().prepare("SELECT 1 FROM users WHERE role = 'admin'").get();
    const role: Role = adminEmails().has(email) || bootstrap ? "admin" : "user";
    const ts = now();
    db()
      .prepare("INSERT INTO users (id, email, name, password_hash, role, plan, created_at) VALUES (?, ?, ?, ?, ?, 'free', ?)")
      .run(id, email, input.name.trim(), hashPassword(input.password), role, ts);
    db()
      .prepare("INSERT INTO credit_ledger (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)")
      .run(id, PLANS.free.monthlyCredits, "créditos do plano Free (cadastro)", ts);
    return getUser(id)!;
  });
}

export function verifyLogin(emailRaw: string, password: string): User {
  const row = db()
    .prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = ?`)
    .get(normalizeEmail(emailRaw)) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, "E-mail ou senha incorretos.");
  if (row.banned_at) throw new HttpError(403, bannedMessage(row));
  if (row.role !== "admin" && adminEmails().has(row.email)) {
    db().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(row.id);
    row.role = "admin";
  }
  const { password_hash: _, ...user } = row;
  return user;
}

const bannedMessage = (u: Pick<User, "ban_reason">) =>
  `Esta conta foi suspensa${u.ban_reason ? `: ${u.ban_reason}` : ""}. Fale com o suporte.`;

export async function startSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, expires.toISOString(), now());
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
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  jar.delete(SESSION_COOKIE);
}

/** Usuário da sessão atual, ou null. Contas suspensas não têm sessão válida. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.plan, u.banned_at, u.ban_reason, u.created_at, u.last_seen_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as (User & { expires_at: string }) | undefined;
  if (!row || row.banned_at || row.expires_at < now()) return null;
  // last_seen com granularidade de minutos: evita escrita a cada requisição.
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 60_000)
    db().prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
  const { expires_at: _, ...user } = row;
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

/** Converte erros conhecidos em resposta JSON; o resto vira 500. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Erro inesperado no servidor." }, { status: 500 });
}

export function logAdmin(actorId: string, action: string, target?: string, detail?: unknown) {
  db()
    .prepare("INSERT INTO admin_log (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(actorId, action, target ?? null, detail === undefined ? null : JSON.stringify(detail), now());
}

export { bannedMessage };
