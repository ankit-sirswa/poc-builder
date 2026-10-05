import { Pool } from "pg";
import { config } from "./config";

/**
 * Postgres (Aiven in production). Lazily created so a missing DATABASE_URL costs nothing,
 * and sized for serverless: one connection per function instance, short idle timeout.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS credentials (
  owner     text        NOT NULL,
  provider  text        NOT NULL,
  iv        text        NOT NULL,
  tag       text        NOT NULL,
  data      text        NOT NULL,
  last4     text        NOT NULL,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, provider)
);

-- Supabase (and similar) publish the public schema through a web API usable with a public "anon" key.
-- Lock the table down so only the server's own database connection can touch it: row-level security
-- with no policies denies those roles, and the explicit REVOKE is a second layer. Harmless elsewhere:
-- the table's owner (our connection) bypasses RLS, and the roles are only revoked if they exist.
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE credentials FROM %I', r);
    END IF;
  END LOOP;
END $$;`;

/** A DATABASE_URL problem the operator can fix. The message never contains the URL (it holds the password). */
export class DatabaseConfigError extends Error {}

/** Splits sslmode out of the URL: node-postgres would otherwise decide TLS behaviour from it, ignoring our CA. */
export function connectionOptions(url: string) {
  // An unencoded "@" in the password splits the URL in the wrong place and the "host" comes out wrong.
  const authority = url.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  const hint = "If the password contains characters like @ # / ? : % it must be URL-encoded (or reset it to letters and digits).";
  if ((authority.match(/@/g) ?? []).length > 1) throw new DatabaseConfigError(`DATABASE_URL has more than one "@" before the host. ${hint}`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseConfigError(`DATABASE_URL isn't a valid URL. ${hint}`);
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) throw new DatabaseConfigError("DATABASE_URL must start with postgres:// or postgresql://.");
  if (!parsed.hostname) throw new DatabaseConfigError(`DATABASE_URL has no host. ${hint}`);
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
