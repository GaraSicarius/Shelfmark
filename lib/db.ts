import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export type QueryFn = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

interface DbHandle {
  query: QueryFn;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function createPgHandle(): DbHandle {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const run: QueryFn = async (sql, params) => {
    const res = await pool.query(sql, params as never[]);
    return res.rows as never[];
  };
  return {
    query: run,
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const txQuery: QueryFn = async (sql, params) => {
          const res = await client.query(sql, params as never[]);
          return res.rows as never[];
        };
        const out = await fn(txQuery);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

function createPgliteHandle(): DbHandle {
  const dataDir = process.env.PGLITE_DIR ?? "./.data/pglite";
  const db = new PGlite(dataDir, { extensions: { vector } });
  // Serialize all access: PGlite is a single connection, and interleaving
  // arbitrary queries with an open transaction would corrupt it.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  };
  const run: QueryFn = (sql, params) =>
    enqueue(async () => (await db.query(sql, params as never[])).rows as never[]);
  return {
    query: run,
    exec: (sql) => enqueue(async () => void (await db.exec(sql))),
    transaction: (fn) =>
      enqueue(() =>
        db.transaction(async (tx) => {
          const txQuery: QueryFn = async (sql, params) =>
            (await tx.query(sql, params as never[])).rows as never[];
          return fn(txQuery);
        }),
      ),
    close: () => db.close(),
  };
}

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db", "migrations");

async function runMigrationsOn(handle: DbHandle): Promise<void> {
  await handle.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const applied = new Set(
    (await handle.query<{ version: string }>("SELECT version FROM schema_migrations")).map(
      (r) => r.version,
    ),
  );
  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await handle.exec(
      `BEGIN;\n${sql}\nINSERT INTO schema_migrations (version) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`,
    );
  }
}

async function initDb(): Promise<DbHandle> {
  const handle = process.env.DATABASE_URL ? createPgHandle() : createPgliteHandle();
  await runMigrationsOn(handle);
  return handle;
}

const g = globalThis as { __shelfmarkDb?: Promise<DbHandle> };

function getDb(): Promise<DbHandle> {
  if (!g.__shelfmarkDb) g.__shelfmarkDb = initDb();
  return g.__shelfmarkDb;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return (await getDb()).query<T>(sql, params);
}

export async function transaction<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  return (await getDb()).transaction(fn);
}

export async function runMigrations(): Promise<void> {
  await getDb();
}

export async function closeDb(): Promise<void> {
  if (!g.__shelfmarkDb) return;
  const handle = await g.__shelfmarkDb;
  g.__shelfmarkDb = undefined;
  await handle.close();
}
