import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { DatabaseConfigError, db } from "./db";
import { UserFacingError } from "./generate";

/**
 * Per-session credential vault. Secrets are AES-256-GCM encrypted at rest and are only
 * ever returned to server code; the API exposes a masked status. Keyed by a hash of the
 * session cookie so storage never holds a usable session id.
 *
 * Storage is Postgres when DATABASE_URL is set (required on Vercel, which has no
 * persistent disk) and a local file otherwise (development).
 */

export type Provider = "openai" | "vercel" | "fetcher-local" | "fetcher-production";
export const PROVIDERS: Provider[] = ["openai", "vercel", "fetcher-local", "fetcher-production"];

interface Sealed {
  iv: string;
  tag: string;
  data: string;
  last4: string;
  savedAt: string;
}

const unavailable = (why: string) => new UserFacingError(`Saving keys isn't available on this server yet: ${why}`, 503);

// ---------- encryption

const keyFile = () => path.join(config.dataDir, "secret.key");

let cachedKey: Buffer | undefined;
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  let secret = config.credentialSecret;
  if (!secret) {
    // A generated key file only makes sense on a machine with a persistent disk.
    if (config.databaseUrl || config.onVercel) throw unavailable("set CREDENTIAL_SECRET (a long random string).");
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(keyFile())) fs.writeFileSync(keyFile(), crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    secret = fs.readFileSync(keyFile(), "utf8").trim();
  }
  cachedKey = crypto.scryptSync(secret, "draftwork-credentials", 32);
  return cachedKey;
}

const owner = (sessionId: string) => crypto.createHash("sha256").update(sessionId).digest("hex");

function seal(value: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64"), last4: value.slice(-4), savedAt: new Date().toISOString() };
}

function unseal(sealed: Sealed): string | undefined {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined; // wrong CREDENTIAL_SECRET or tampered data: treat as not saved
  }
}

// ---------- storage backends

interface Backend {
  put(owner: string, provider: Provider, sealed: Sealed): Promise<void>;
  get(owner: string, provider: Provider): Promise<Sealed | undefined>;
  remove(owner: string, provider: Provider): Promise<void>;
  list(owner: string): Promise<Partial<Record<Provider, Sealed>>>;
}

type FileStore = Record<string, Partial<Record<Provider, Sealed>>>;
const storeFile = () => path.join(config.dataDir, "credentials.json");

const fileBackend: Backend = {
  async put(id, provider, sealed) {
    const store = readFileStore();
    store[id] = { ...store[id], [provider]: sealed };
    writeFileStore(store);
  },
  async get(id, provider) {
    return readFileStore()[id]?.[provider];
  },
  async remove(id, provider) {
    const store = readFileStore();
    if (!store[id]?.[provider]) return;
    delete store[id][provider];
    if (Object.keys(store[id]).length === 0) delete store[id];
    writeFileStore(store);
  },
  async list(id) {
    return readFileStore()[id] ?? {};
  },
};

function readFileStore(): FileStore {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf8")) as FileStore;
  } catch {
    return {};
  }
}

function writeFileStore(store: FileStore) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${storeFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
    fs.renameSync(tmp, storeFile());
  } catch {
    throw unavailable("this host has no writable disk. Set DATABASE_URL to store keys in Postgres.");
  }
}

const rowToSealed = (row: { iv: string; tag: string; data: string; last4: string; saved_at: Date }): Sealed => ({
  iv: row.iv,
  tag: row.tag,
  data: row.data,
  last4: row.last4,
  savedAt: row.saved_at.toISOString(),
});

/** Database failures are infrastructure problems, not the user's: say so without leaking connection details. */
async function withDb<T>(fn: (pool: Awaited<ReturnType<typeof db>>) => Promise<T>): Promise<T> {
  try {
    return await fn(await db());
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    if (error instanceof DatabaseConfigError) {
      console.error("Database misconfigured:", error.message);
      throw new UserFacingError(`The database connection is misconfigured: ${error.message}`, 503);
    }
    console.error("Postgres error:", (error as { code?: string; name?: string })?.code ?? (error as Error)?.name);
    throw new UserFacingError("The database isn't reachable right now. Your typed keys still work; saving keys needs it. Please retry.", 503);
  }
}

const pgBackend: Backend = {
  put: (id, provider, s) =>
    withDb(async (pool) => {
      await pool.query(
        `INSERT INTO credentials (owner, provider, iv, tag, data, last4, saved_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (owner, provider) DO UPDATE SET iv = EXCLUDED.iv, tag = EXCLUDED.tag, data = EXCLUDED.data, last4 = EXCLUDED.last4, saved_at = EXCLUDED.saved_at`,
        [id, provider, s.iv, s.tag, s.data, s.last4, s.savedAt],
      );
    }),
  get: (id, provider) =>
    withDb(async (pool) => {
      const { rows } = await pool.query("SELECT iv, tag, data, last4, saved_at FROM credentials WHERE owner = $1 AND provider = $2", [id, provider]);
      return rows[0] ? rowToSealed(rows[0]) : undefined;
    }),
  remove: (id, provider) =>
    withDb(async (pool) => {
      await pool.query("DELETE FROM credentials WHERE owner = $1 AND provider = $2", [id, provider]);
    }),
  list: (id) =>
    withDb(async (pool) => {
      const { rows } = await pool.query("SELECT provider, iv, tag, data, last4, saved_at FROM credentials WHERE owner = $1", [id]);
      return Object.fromEntries(rows.map((row) => [row.provider, rowToSealed(row)])) as Partial<Record<Provider, Sealed>>;
    }),
};

const backend = (): Backend => (config.databaseUrl ? pgBackend : fileBackend);

// ---------- public API

export async function saveCredential(sessionId: string, provider: Provider, value: string) {
  await backend().put(owner(sessionId), provider, seal(value));
}

export async function getCredential(sessionId: string, provider: Provider): Promise<string | undefined> {
  const sealed = await backend().get(owner(sessionId), provider);
  return sealed ? unseal(sealed) : undefined;
}

export async function removeCredential(sessionId: string, provider: Provider) {
  await backend().remove(owner(sessionId), provider);
}

export async function credentialStatus(sessionId: string) {
  const mine = await backend().list(owner(sessionId));
  return Object.fromEntries(
    PROVIDERS.map((p) => [p, mine[p] ? { saved: true, last4: mine[p]!.last4, savedAt: mine[p]!.savedAt } : { saved: false }]),
  ) as Record<Provider, { saved: boolean; last4?: string; savedAt?: string }>;
}
