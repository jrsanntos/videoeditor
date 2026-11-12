/**
 * Migrações do Postgres, aplicadas em ordem e uma única vez (tabela schema_migrations).
 * Nunca edite uma migração já publicada: acrescente outra ao fim da lista.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
CREATE TABLE users (
  id text PRIMARY KEY,
  -- Sempre normalizado (minúsculas, sem espaços) antes de gravar.
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'creator', 'pro')),
  -- Saldos materializados do ledger: leitura O(1) e débito atômico com bloqueio de linha.
  credits_plan integer NOT NULL DEFAULT 0,
  credits_extra integer NOT NULL DEFAULT 0,
  -- Créditos de plano já concedidos no ciclo atual (base para o complemento em upgrades).
  credits_cycle_grant integer NOT NULL DEFAULT 0,
  credits_renew_at timestamptz NOT NULL,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  subscription_status text,
  subscription_period_end timestamptz,
  subscription_cancel_at_period_end boolean NOT NULL DEFAULT false,
  banned_at timestamptz,
  ban_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX users_created_idx ON users (created_at DESC);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);

-- Contadores de janela fixa para limitar requisições. UNLOGGED: sem WAL,
-- escrita barata; perder os contadores numa queda do banco é aceitável.
CREATE UNLOGGED TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- Ledger de créditos: nada é sobrescrito. A soma por usuário é igual a credits_plan + credits_extra.
CREATE TABLE credit_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta integer NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('plan', 'extra')),
  reason text NOT NULL,
  actor_id text,
  -- Chave de idempotência (fatura/checkout do Stripe): a mesma concessão nunca entra duas vezes.
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, id DESC);
CREATE UNIQUE INDEX credit_ledger_ref_key ON credit_ledger (ref) WHERE ref IS NOT NULL;

-- Custo real de cada chamada de IA (despesa automática).
CREATE TABLE usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  provider text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  audio_seconds double precision NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6) NOT NULL,
  credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_created_idx ON usage_events (created_at);
CREATE INDEX usage_events_user_idx ON usage_events (user_id, id DESC);

CREATE TABLE payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  amount_brl numeric(12, 2) NOT NULL,
  description text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stripe')),
  -- Id da fatura/checkout no Stripe: garante um lançamento por cobrança.
  ref text UNIQUE,
  actor_id text,
  paid_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_paid_idx ON payments (paid_at);
CREATE INDEX payments_user_idx ON payments (user_id);

CREATE TABLE expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  description text NOT NULL,
  amount_brl numeric(12, 2) NOT NULL,
  actor_id text,
  spent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_spent_idx ON expenses (spent_at);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  encrypted boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  data jsonb NOT NULL,
  source_name text NOT NULL,
  source_duration double precision NOT NULL,
  thumbnail text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX templates_status_idx ON templates (status, updated_at DESC);

CREATE TABLE admin_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Eventos do Stripe já processados (webhooks podem chegar repetidos).
CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    id: "002_brand_kit",
    sql: `ALTER TABLE users ADD COLUMN brand_kit jsonb;`,
  },
  {
    // Meio crédito por comando no chat: saldos e ledger passam a aceitar uma casa decimal.
    id: "003_fractional_credits",
    sql: `
ALTER TABLE users
  ALTER COLUMN credits_plan TYPE numeric(12, 1),
  ALTER COLUMN credits_extra TYPE numeric(12, 1),
  ALTER COLUMN credits_cycle_grant TYPE numeric(12, 1);
ALTER TABLE credit_ledger ALTER COLUMN delta TYPE numeric(12, 1);
ALTER TABLE usage_events ALTER COLUMN credits TYPE numeric(12, 1);
`,
  },
  {
    // Vários Brand Kits por conta (limite pelo plano). O kit único de antes vira o primeiro.
    id: "004_brand_kits",
    sql: `
CREATE TABLE brand_kits (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX brand_kits_user_idx ON brand_kits (user_id, created_at);
INSERT INTO brand_kits (id, user_id, name, data)
  SELECT 'brd_' || md5(id), id, 'Minha marca', brand_kit FROM users WHERE brand_kit IS NOT NULL;
ALTER TABLE users DROP COLUMN brand_kit;
`,
  },
  {
    // Confirmação de e-mail no cadastro. Contas que já existiam contam como confirmadas.
    id: "005_email_verification",
    sql: `
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = created_at;
CREATE TABLE email_verifications (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);
`,
  },
];
