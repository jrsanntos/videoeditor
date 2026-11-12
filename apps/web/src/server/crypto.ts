import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";

/** Senhas: scrypt com sal aleatório. Formato: scrypt$N$sal$hash (base64url). */
const N = 16384;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N });
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Chave mestra para cifrar segredos guardados no banco (chaves de API).
 * Use APP_SECRET em produção; sem ela, é gerada uma vez em DATA_DIR/secret.key.
 * Perder a chave torna as chaves de API salvas ilegíveis (basta cadastrá-las de novo).
 */
function masterKey(): Buffer {
  const env = process.env.APP_SECRET;
  if (env) return crypto.createHash("sha256").update(env).digest();
  const file = path.join(DATA_DIR, "secret.key");
  try {
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  } catch {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString("base64"), { mode: 0o600, flag: "wx" });
    return key;
  }
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8");
}
