import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

/** Lazy pool so the server can start without DATABASE_URL; throws when DB is first used if unset. */
export const pool = new Proxy({} as pg.Pool, {
  get(_, prop) {
    return (getPool() as Record<string | symbol, unknown>)[prop];
  },
});

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

/** Lazy db so the server can start without DATABASE_URL; throws when DB is first used if unset. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_, prop) {
    return (getDb() as Record<string | symbol, unknown>)[prop];
  },
});

export * from "./schema";
