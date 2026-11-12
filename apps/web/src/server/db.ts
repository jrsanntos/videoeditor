import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { MIGRATIONS } from "./schema";

/**
 * Banco do servidor: Postgres (DATABASE_URL). Todo acesso passa por `db`, que
 * usa o pool ou, dentro de `tx`, a conexão da transação corrente — quem é
 * chamado dentro de uma transação participa dela sem receber nada por parâmetro.
 */

type Params = readonly unknown[];
type Queryable = { query: (text: string, params?: unknown[]) => Promise<pg.QueryResult> };

// bigint (COUNT/SUM de inteiros) e numeric viram number; timestamptz vira string ISO,
// o formato que o resto da aplicação e a interface já usam.
const NUMERIC_OIDS = new Set([pg.types.builtins.INT8, pg.types.builtins.NUMERIC]);
const types: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (format !== "binary") {
      if (NUMERIC_OIDS.has(oid)) return Number;
      if (oid === pg.types.builtins.TIMESTAMPTZ) {
        const parse = pg.types.getTypeParser(oid) as (v: string) => Date;
        return (v: string) => parse(v).toISOString();
      }
    }
    return pg.types.getTypeParser(oid, format as "text");
  }) as pg.CustomTypesConfig["getTypeParser"],
};

const g = globalThis as unknown as { __vePool?: pg.Pool; __veReady?: Promise<void> };
const scope = new AsyncLocalStorage<pg.PoolClient>();

function pool(): pg.Pool {
  if (g.__vePool) return g.__vePool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL não definida. Aponte para um Postgres (veja apps/web/.env.example e docker-compose.yml).");
  const created = new pg.Pool({
    connectionString,
    types,
    // Em serverless, use a URL do pooler do provedor (PgBouncer) e um máximo baixo por instância.
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    application_name: "videoeditor-web",
  });
  // Erro numa conexão ociosa (queda do banco, failover) não pode derrubar o processo.
  created.on("error", (e) => console.error("postgres: erro em conexão ociosa", e));
  g.__vePool = created;
  return created;
}

async function migrate() {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    // Várias instâncias subindo juntas: só uma aplica as migrações por vez.
    await client.query("SELECT pg_advisory_xact_lock(727274001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map((r: { id: string }) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
      console.log(`postgres: migração ${m.id} aplicada`);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Garante o schema antes da primeira consulta do processo. Uma falha é tentada de novo na próxima chamada. */
function ready(): Promise<void> {
  g.__veReady ??= migrate().catch((e) => {
    g.__veReady = undefined;
    throw e;
  });
  return g.__veReady;
}

async function target(): Promise<Queryable> {
  const client = scope.getStore();
  if (client) return client;
  await ready();
  return pool();
}

export const db = {
  /** Todas as linhas. */
  async query<T = Record<string, unknown>>(text: string, params: Params = []): Promise<T[]> {
    return (await (await target()).query(text, params as unknown[])).rows as T[];
  },
  /** Primeira linha, ou undefined. */
  async one<T = Record<string, unknown>>(text: string, params: Params = []): Promise<T | undefined> {
    return (await (await target()).query(text, params as unknown[])).rows[0] as T | undefined;
  },
  /** Número de linhas afetadas. */
  async run(text: string, params: Params = []): Promise<number> {
    return (await (await target()).query(text, params as unknown[])).rowCount ?? 0;
  },
};

/** Executa `fn` numa transação. Chamadas aninhadas entram na transação já aberta. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();
  await ready();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await scope.run(client, fn);
    await client.query("COMMIT");
    client.release();
    return out;
  } catch (e) {
    // Conexão em estado duvidoso é descartada em vez de voltar ao pool.
    const rolledBack = await client.query("ROLLBACK").then(
      () => true,
      () => false,
    );
    client.release(!rolledBack);
    throw e;
  }
}

export const now = () => new Date().toISOString();
