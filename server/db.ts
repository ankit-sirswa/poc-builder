import { Pool } from "pg";
import { config } from "./config";

/**
 * Postgres (Aiven in production). Lazily created so a missing DATABASE_URL costs nothing,
 * and sized for serverless: one connection per function instance, short idle timeout.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credentials (
  owner     text        NOT NULL,
  provider  text        NOT NULL,
  iv        text        NOT NULL,
  tag       text        NOT NULL,
  data      text        NOT NULL,
  last4     text        NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, provider)
);`;

/** Splits sslmode out of the URL: node-postgres would otherwise decide TLS behaviour from it, ignoring our CA. */
function connectionOptions(url: string) {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get("sslmode");
  parsed.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  let ssl: false | { ca?: string; rejectUnauthorized: boolean };
  if (sslmode === "disable" || (local && !sslmode)) ssl = false;
  else if (config.databaseCaCert) ssl = { ca: config.databaseCaCert, rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: false }; // encrypted, but the server's identity isn't verified without the CA
  return { connectionString: parsed.toString(), ssl };
}

let pool: Pool | undefined;
let ready: Promise<void> | undefined;

function getPool(): Pool {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not set.");
  if (!pool) {
    pool = new Pool({ ...connectionOptions(config.databaseUrl), max: config.databasePoolMax, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
    // An idle client erroring (e.g. the server closing it) must not crash the process.
    pool.on("error", (error) => console.error("Postgres pool error:", error.name));
  }
  return pool;
}

/** The pool, with the schema created once per instance. Safe if several cold starts race (advisory lock). */
export async function db(): Promise<Pool> {
  const p = getPool();
  ready ??= (async () => {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(727001)");
      await client.query(SCHEMA);
      // Saved keys belong to a browser cookie that lasts 90 days; rows from cleared cookies would otherwise pile up.
      await client.query("DELETE FROM credentials WHERE saved_at < now() - interval '120 days'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    ready = undefined; // let the next request retry instead of caching the failure
    throw error;
  });
  await ready;
  return p;
}

/** For tests and graceful shutdown. */
export async function closeDb() {
  const p = pool;
  pool = undefined;
  ready = undefined;
  await p?.end();
}
