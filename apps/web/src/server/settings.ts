import "server-only";
import { db } from "./db";
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
  GEMINI_API_KEY: { label: "Google Gemini (modelo reserva quando a Anthropic falhar)", secret: true, env: ["GEMINI_API_KEY"] },
  GEMINI_MODEL: { label: "Modelo reserva do Google", secret: false, env: ["GEMINI_MODEL"] },
  GEMINI_IMAGE_MODEL: { label: "Modelo de imagem gerada por IA (padrão: gemini-nano-banana-2.1)", secret: false, env: ["GEMINI_IMAGE_MODEL"] },
  GEMINI_VIDEO_MODEL: { label: "Modelo de vídeo gerado por IA (padrão: gemini-omni-1.2-flash)", secret: false, env: ["GEMINI_VIDEO_MODEL"] },
  GEMINI_PRICE_INPUT: { label: "Preço do modelo reserva: US$ por milhão de tokens de entrada", secret: false, env: [] as string[] },
  GEMINI_PRICE_OUTPUT: { label: "Preço do modelo reserva: US$ por milhão de tokens de saída", secret: false, env: [] as string[] },
  AGENT_MODEL: { label: "Modelo do agente (edição completa)", secret: false, env: ["AGENT_MODEL"] },
  AGENT_MODEL_FAST: { label: "Modelo rápido do agente (ajustes pontuais)", secret: false, env: ["AGENT_MODEL_FAST"] },
  AGENT_MODEL_EDITOR: { label: "Modelo do Editor (executa o plano do Diretor)", secret: false, env: ["AGENT_MODEL_EDITOR"] },
  AGENT_MODEL_CRITIC: { label: "Modelo do Crítico visual", secret: false, env: ["AGENT_MODEL_CRITIC"] },
  USD_BRL: { label: "Cotação US$ → R$ (para despesas)", secret: false, env: [] as string[] },
  STRIPE_SECRET_KEY: { label: "Stripe: chave secreta (sk_…)", secret: true, env: ["STRIPE_SECRET_KEY"] },
  STRIPE_WEBHOOK_SECRET: { label: "Stripe: segredo do webhook (whsec_…)", secret: true, env: ["STRIPE_WEBHOOK_SECRET"] },
  STRIPE_PRICE_CREATOR: { label: "Stripe: preço mensal do plano Creator (price_…)", secret: false, env: ["STRIPE_PRICE_CREATOR"] },
  STRIPE_PRICE_PRO: { label: "Stripe: preço mensal do plano Pro (price_…)", secret: false, env: ["STRIPE_PRICE_PRO"] },
  STRIPE_PRICE_TOPUP: { label: "Stripe: preço avulso do pacote de créditos (price_…)", secret: false, env: ["STRIPE_PRICE_TOPUP"] },
  PEXELS_API_KEY: { label: "Pexels (banco gratuito de vídeos e fotos)", secret: true, env: ["PEXELS_API_KEY"] },
  PIXABAY_API_KEY: { label: "Pixabay (banco gratuito de vídeos e fotos)", secret: true, env: ["PIXABAY_API_KEY"] },
  RESEND_API_KEY: { label: "Resend (envio de e-mails)", secret: true, env: ["RESEND_API_KEY"] },
  EMAIL_FROM: { label: "Remetente dos e-mails", secret: false, env: ["EMAIL_FROM"] },
  GOOGLE_CLIENT_ID: { label: "Login com Google: Client ID (…apps.googleusercontent.com)", secret: false, env: ["GOOGLE_CLIENT_ID"] },
  GOOGLE_CLIENT_SECRET: { label: "Login com Google: Client secret", secret: true, env: ["GOOGLE_CLIENT_SECRET"] },
} as const;
export type SettingKey = keyof typeof SETTINGS;

export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

type Row = { key: SettingKey; value: string; encrypted: boolean; updated_at: string };

function effective(key: SettingKey, row: Row | undefined): string | undefined {
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

/** Valor efetivo: banco primeiro, depois as variáveis de ambiente. */
export async function getSetting(key: SettingKey): Promise<string | undefined> {
  const row = await db.one<Row>("SELECT key, value, encrypted, updated_at FROM settings WHERE key = $1", [key]);
  return effective(key, row);
}

/** Várias configurações numa única ida ao banco. */
export async function getSettings<K extends SettingKey>(keys: readonly K[]): Promise<Record<K, string | undefined>> {
  const rows = await db.query<Row>("SELECT key, value, encrypted, updated_at FROM settings WHERE key = ANY($1)", [keys]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return Object.fromEntries(keys.map((k) => [k, effective(k, byKey.get(k))])) as Record<K, string | undefined>;
}

export async function setSetting(key: SettingKey, value: string | null, actorId: string) {
  if (value === null || value.trim() === "") {
    await db.run("DELETE FROM settings WHERE key = $1", [key]);
    return;
  }
  const secret = SETTINGS[key].secret;
  await db.run(
    `INSERT INTO settings (key, value, encrypted, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [key, secret ? encrypt(value.trim()) : value.trim(), secret, actorId],
  );
}

/** Visão para o painel: nunca devolve o segredo, só os 4 últimos caracteres. */
export async function describeSettings() {
  const rows = await db.query<Row>("SELECT key, value, encrypted, updated_at FROM settings");
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const def = SETTINGS[key];
    const row = byKey.get(key);
    const value = effective(key, row);
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
