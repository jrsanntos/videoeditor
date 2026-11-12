import "server-only";
import { db, now } from "./db";
import { decrypt, encrypt } from "./crypto";

/**
 * Configurações editáveis no painel. Chaves de API ficam cifradas no banco e
 * têm prioridade sobre as variáveis de ambiente; apagar no painel volta ao env.
 */
export const SETTINGS = {
  ANTHROPIC_API_KEY: {
    label: "Anthropic (agente e extração de modelos)",
    secret: true,
    env: ["ANTHROPIC_API_KEY", "VIDEOEDITOR_ANTHROPIC_KEY"],
  },
  GROQ_API_KEY: { label: "Groq (transcrição)", secret: true, env: ["GROQ_API_KEY"] },
  AGENT_MODEL: { label: "Modelo do agente", secret: false, env: ["AGENT_MODEL"] },
  USD_BRL: { label: "Cotação US$ → R$ (para despesas)", secret: false, env: [] as string[] },
} as const;
export type SettingKey = keyof typeof SETTINGS;

export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

type Row = { value: string; encrypted: number; updated_at: string };

function readRow(key: SettingKey): Row | undefined {
  return db().prepare("SELECT value, encrypted, updated_at FROM settings WHERE key = ?").get(key) as Row | undefined;
}

/** Valor efetivo: banco primeiro, depois as variáveis de ambiente. */
export function getSetting(key: SettingKey): string | undefined {
  const row = readRow(key);
  if (row) {
    try {
      return row.encrypted ? decrypt(row.value) : row.value;
    } catch {
      console.error(`configuração ${key} ilegível (APP_SECRET mudou?); usando o ambiente`);
    }
  }
  for (const name of SETTINGS[key].env) if (process.env[name]) return process.env[name];
  return undefined;
}

export function setSetting(key: SettingKey, value: string | null, actorId: string) {
  if (value === null || value.trim() === "") {
    db().prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }
  const secret = SETTINGS[key].secret;
  db()
    .prepare(
      `INSERT INTO settings (key, value, encrypted, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(key, secret ? encrypt(value.trim()) : value.trim(), secret ? 1 : 0, actorId, now());
}

/** Visão para o painel: nunca devolve o segredo, só os 4 últimos caracteres. */
export function describeSettings() {
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const def = SETTINGS[key];
    const row = readRow(key);
    const value = getSetting(key);
    const source = row ? "painel" : value ? "ambiente" : "não definida";
    return {
      key,
      label: def.label,
      secret: def.secret,
      source,
      preview: value ? (def.secret ? `••••${value.slice(-4)}` : value) : null,
      updatedAt: row?.updated_at ?? null,
    };
  });
}
