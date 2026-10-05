import path from "node:path";
import { cleanEnv } from "./env";

// Load .env (Node 20.12+). Variables already in the environment win.
try {
  process.loadEnvFile(path.resolve(".env"));
} catch {
  /* no .env file: everything is configured through the UI */
}

const env = process.env;
/** An env var with dashboard-paste mishaps (quotes, whitespace) cleaned off. */
const val = (name: string) => cleanEnv(name, env[name]);

/** A PEM from an env var: base64 of the PEM, or the PEM itself (with real or escaped newlines). */
function pem(value: string | undefined): string | undefined {
  const raw = (value || "").trim();
  if (!raw) return undefined;
  if (raw.includes("BEGIN CERTIFICATE")) return raw.replace(/\\n/g, "\n");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  return decoded.includes("BEGIN CERTIFICATE") ? decoded : undefined;
}

export type FetcherTarget = "local" | "production";
export const FETCHER_TARGETS: FetcherTarget[] = ["local", "production"];
const cleanUrl = (value: string | undefined) => (value || "").trim().replace(/\/+$/, "") || undefined;

function fetcherConfig() {
  const targets: Record<FetcherTarget, { url?: string; defaultKey?: string }> = {
    // JOB_FETCHER_URL / JOB_FETCHER_API_KEY are accepted as the local target's older names.
    local: { url: cleanUrl(val("JOB_FETCHER_LOCAL_URL") || val("JOB_FETCHER_URL")), defaultKey: val("JOB_FETCHER_LOCAL_API_KEY") || val("JOB_FETCHER_API_KEY") },
    production: { url: cleanUrl(val("JOB_FETCHER_PROD_URL")), defaultKey: val("JOB_FETCHER_PROD_API_KEY") },
  };
  const wanted = (val("JOB_FETCHER_TARGET") || "").toLowerCase();
  const configured = FETCHER_TARGETS.filter((t) => targets[t].url);
  const defaultTarget = (configured.find((t) => t === wanted) ?? configured[0]) as FetcherTarget | undefined;
  return { targets, defaultTarget };
}

export const config = {
  port: Number(env.PORT ?? 8787),
  /** True when running as a Vercel function: no writable disk, a hard time limit, and one DB connection per instance. */
  onVercel: Boolean(env.VERCEL),
  /** Aiven (or any) Postgres. When set, saved keys live here instead of in a local file. */
  databaseUrl: val("DATABASE_URL"),
  /** CA certificate for verified TLS to the database (Aiven's ca.pem). Base64 (preferred) or raw PEM. */
  databaseCaCert: pem(env.DATABASE_CA_CERT_B64 || env.DATABASE_CA_CERT),
  databasePoolMax: Number(env.DATABASE_POOL_MAX) > 0 ? Number(env.DATABASE_POOL_MAX) : env.VERCEL ? 1 : 5,
  /** How long to wait for OpenAI. On Vercel this stays under the function's time limit so the user gets a clear message, not a platform 504. */
  generationTimeoutMs: Number(env.GENERATION_TIMEOUT_MS) > 0 ? Number(env.GENERATION_TIMEOUT_MS) : env.VERCEL ? 55_000 : 180_000,
  /** Optional shared password. When set, every API call except health and login needs a signed-in session. */
  appPassword: env.APP_PASSWORD || undefined,
  sessionSecret: env.SESSION_SECRET || env.CREDENTIAL_SECRET || undefined,
  /** Cap on generate/deploy calls per minute per client (they cost money). */
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MIN) > 0 ? Number(env.RATE_LIMIT_PER_MIN) : 12,
  production: env.NODE_ENV === "production",
  /** Where encrypted credentials are kept. */
  dataDir: env.DATA_DIR || path.resolve(".data"),
  /** Optional. If unset, a random key is generated into the data dir on first run. */
  credentialSecret: env.CREDENTIAL_SECRET || undefined,
  /** Overridable so tests can point at fake upstreams. */
  openaiBaseUrl: env.OPENAI_BASE_URL || undefined,
  vercelApiBase: env.VERCEL_API_BASE || "https://api.vercel.com",
  /**
   * Server-wide defaults from .env. Anyone using the app falls back to these
   * when they haven't typed or saved their own in the UI. Values never leave
   * the server; the UI only learns whether a default exists.
   */
  /**
   * Job Fetcher (the monorepo's job collector), as named targets chosen in the UI.
   * URLs live only here: the UI picks "local" or "production", never a URL, so a
   * user can't aim the server (and an API key) at an arbitrary host.
   */
  fetcher: fetcherConfig(),
  defaults: {
    openaiKey: val("OPENAI_API_KEY") || val("OPENAI_KEY"),
    vercelToken: val("VERCEL_TOKEN"),
    vercelTeamId: val("VERCEL_TEAM_ID") || val("TEAM_ID"),
    model: val("OPENAI_MODEL"),
  },
};

// Fail loudly rather than run with a login that can't be signed.
if (config.appPassword && !config.sessionSecret) {
  throw new Error("APP_PASSWORD is set but SESSION_SECRET is missing. Set SESSION_SECRET to a long random string.");
}
