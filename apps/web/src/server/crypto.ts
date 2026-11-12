import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Só para a chave de cifra em desenvolvimento; fora do rastreamento de arquivos do bundler.
const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(process.cwd(), ".data"));

/** Senhas: scrypt com sal aleatório. Formato: scrypt$N$sal$hash (base64url). */
const N = 16384;

// Versão assíncrona: o cálculo roda no pool de threads e não trava as outras requisições.
const scrypt = (password: string, salt: Buffer, length: number, cost: number) =>
  new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, length, { N: cost }, (err, key) => (err ? reject(err) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, N);
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, Number(n));
  return crypto.timingSafeEqual(actual, expected);
}

export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * Chave mestra para cifrar segredos guardados no banco (chaves de API).
 * APP_SECRET é obrigatória em produção (o disco da instância não é durável nem
 * compartilhado); em desenvolvimento, sem ela, é gerada uma vez em DATA_DIR/secret.key.
 * Perder a chave torna as chaves de API salvas ilegíveis (basta cadastrá-las de novo).
 */
function masterKey(): Buffer {
  const env = process.env.APP_SECRET;
  if (env) return crypto.createHash("sha256").update(env).digest();
  if (process.env.NODE_ENV === "production")
    throw new Error("APP_SECRET não definida: obrigatória em produção para cifrar as chaves salvas no painel.");
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
