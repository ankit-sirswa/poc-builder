import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { BriefSchema, MODELS, PocSchema, normalizePoc } from "../shared/schema";
import { FETCHER_TARGETS, config, type FetcherTarget } from "./config";
import { PROVIDERS, credentialStatus, getCredential, removeCredential, saveCredential, type Provider } from "./credentials";
import { authGate, authRouter } from "./auth";
import { lookupJob } from "./fetcher";
import { UserFacingError, generatePoc, listChatModels } from "./generate";
import { createDeployment, getDeployment } from "./vercel";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

/** Anonymous session: a random id in an httpOnly cookie owns this browser's saved credentials. */
declare module "express-serve-static-core" {
  interface Request {
    sid: string;
  }
}
app.use("/api", (req, res, next) => {
  let sid = req.cookies?.pb_sid as string | undefined;
  if (!sid || !/^[a-f0-9]{64}$/.test(sid)) {
    sid = crypto.randomBytes(32).toString("hex");
    res.cookie("pb_sid", sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: 1000 * 60 * 60 * 24 * 90,
    });
  }
  req.sid = sid;
  next();
});

/** State-changing calls must come from this app's own origin. */
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  const origin = req.get("origin");
  if (origin && new URL(origin).host !== req.get("host")) {
    return res.status(403).json({ error: "Cross-origin requests are not allowed." });
  }
  next();
});

// Sign-in endpoints first (they must stay reachable), then everything else sits behind the gate when APP_PASSWORD is set.
app.use("/api/auth", authRouter);
app.use("/api", authGate);

const heavyLimit = rateLimit({ windowMs: 60_000, limit: config.rateLimitPerMinute, standardHeaders: true, legacyHeaders: false });
const lookupLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

const secretField = z.string().trim().min(8).max(500).regex(/^\S+$/, "Keys can't contain spaces.");
const providerParam = (req: Request): Provider => {
  const provider = req.params.provider as Provider;
  if (!PROVIDERS.includes(provider)) throw new UserFacingError("Unknown provider.", 404);
  return provider;
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

/** Which providers have a server-side default from .env (never the values). */
const hasDefault: Record<Provider, boolean> = {
  openai: Boolean(config.defaults.openaiKey),
  vercel: Boolean(config.defaults.vercelToken),
  "fetcher-local": Boolean(config.fetcher.targets.local.defaultKey),
  "fetcher-production": Boolean(config.fetcher.targets.production.defaultKey),
};
const withDefaults = async (sid: string) => {
  const status = await credentialStatus(sid);
  return Object.fromEntries(PROVIDERS.map((p) => [p, { ...status[p], hasDefault: hasDefault[p] }]));
};

type KeySource = "typed" | "saved" | "default";

/** One-off key from the request, else this session's saved key, else the .env default. */
const envDefault: Record<Provider, string | undefined> = {
  openai: config.defaults.openaiKey,
  vercel: config.defaults.vercelToken,
  "fetcher-local": config.fetcher.targets.local.defaultKey,
  "fetcher-production": config.fetcher.targets.production.defaultKey,
};
const resolveSecret = async (sid: string, provider: Provider, oneOff?: string): Promise<{ value: string; source: KeySource } | null> => {
  if (oneOff) return { value: oneOff, source: "typed" };
  const saved = await getCredential(sid, provider);
  if (saved) return { value: saved, source: "saved" };
  const fallback = envDefault[provider];
  return fallback ? { value: fallback, source: "default" } : null;
};

/**
 * A 401 from a provider is far more useful when it says WHICH credential was used:
 * a rejected .env default can only be fixed in .env (or by pasting your own).
 */
function explainRejection(error: unknown, source: KeySource, what: { provider: string; noun: string; env: string }, value?: string) {
  if (!(error instanceof UserFacingError) || error.status !== 401) return error;
  const why = error.detail ? `: ${error.detail}` : "";
  if (source === "default") {
    return new UserFacingError(
      `${what.provider} rejected the server's default ${what.noun} (${what.env} in .env)${why}. Fix it in .env and restart the server, or choose "Use my own" and paste a working one.`,
      401,
      error.usage,
      undefined,
      "invalid_key",
    );
  }
  // Typed and saved keys are the user's own, so naming the last four characters is safe and shows which one was sent.
  const ending = value ? ` ending ${value.slice(-4)}` : "";
  if (source === "saved") {
    return new UserFacingError(`${what.provider} rejected your saved ${what.noun}${ending}${why}. Replace it with a working one, or remove it.`, 401, error.usage, undefined, "invalid_key");
  }
  return new UserFacingError(`${what.provider} rejected the ${what.noun} you entered${ending}${why}.`, 401, error.usage, undefined, "invalid_key");
}

/** Host only: the URL itself can carry a path, and a host is all the UI needs to show. */
const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

app.get("/api/config", (_req, res) => {
  const models = [...MODELS] as { id: string; label: string }[];
  const fallback = config.defaults.model;
  if (fallback && !models.some((m) => m.id === fallback)) models.unshift({ id: fallback, label: `${fallback} · server default` });
  res.json({ models, defaultModel: fallback ?? null, hasDefaultTeam: Boolean(config.defaults.vercelTeamId), fetcher: { defaultTarget: config.fetcher.defaultTarget ?? null, targets: FETCHER_TARGETS.map((id) => ({ id, configured: Boolean(config.fetcher.targets[id].url), host: hostOf(config.fetcher.targets[id].url) })) } });
});

app.get("/api/credentials", async (req, res) => res.json(await withDefaults(req.sid)));

app.put("/api/credentials/:provider", async (req, res) => {
  const provider = providerParam(req);
  const parsed = secretField.safeParse(req.body?.value);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "Enter a valid key.");
  await saveCredential(req.sid, provider, parsed.data);
  res.json(await withDefaults(req.sid));
});

app.delete("/api/credentials/:provider", async (req, res) => {
  await removeCredential(req.sid, providerParam(req));
  res.json(await withDefaults(req.sid));
});

const GenerateBody = BriefSchema.extend({
  // The model list comes from OpenAI (what the key can actually use), so only the id's shape is checked here.
  model: z.string().regex(/^[\w.:-]{1,80}$/, "Unknown model."),
  /** One-off key for this request. Never stored unless saved through /api/credentials. */
  apiKey: secretField.optional(),
});

app.post("/api/generate", heavyLimit, async (req, res) => {
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) throw new UserFacingError("Add a job title and description to build a prototype.");
  const { model, apiKey, ...brief } = parsed.data;
  const key = await resolveSecret(req.sid, "openai", apiKey);
  if (!key) throw new UserFacingError("Enter your OpenAI API key to build the prototype.", 401, undefined, undefined, "key_required");
  try {
    res.json(await generatePoc({ brief, model, apiKey: key.value }));
  } catch (error) {
    throw explainRejection(error, key.source, { provider: "OpenAI", noun: "API key", env: "OPENAI_KEY" }, key.value);
  }
});

/** Which chat models this key can use, so the model list is never a guess. */
app.post("/api/models", lookupLimit, async (req, res) => {
  const parsed = z.object({ apiKey: secretField.optional() }).safeParse(req.body ?? {});
  if (!parsed.success) throw new UserFacingError("That key doesn't look right.");
  const key = await resolveSecret(req.sid, "openai", parsed.data.apiKey);
  if (!key) throw new UserFacingError("Enter your OpenAI API key first.", 401, undefined, undefined, "key_required");
  try {
    res.json({ models: await listChatModels(key.value, config.defaults.model) });
  } catch (error) {
    // Restricted keys can be barred from listing models while still being able to use them: not a bad key.
    if (error instanceof UserFacingError && error.status === 403) return res.json({ models: [], unverified: true });
    throw explainRejection(error, key.source, { provider: "OpenAI", noun: "API key", env: "OPENAI_KEY" }, key.value);
  }
});

const LookupBody = z.object({ jobId: z.string().trim().min(1).max(512), target: z.enum(FETCHER_TARGETS as [FetcherTarget, ...FetcherTarget[]]).optional(), apiKey: secretField.optional() });

/** Fills the brief from a Job Fetcher job. Key precedence matches the others: typed, saved, then .env. */
app.post("/api/fetcher/lookup", lookupLimit, async (req, res) => {
  const parsed = LookupBody.safeParse(req.body);
  if (!parsed.success) throw new UserFacingError("Paste an Upwork job ID or URL first.");
  const target = parsed.data.target ?? config.fetcher.defaultTarget ?? "local";
  res.json(await lookupJob({ jobId: parsed.data.jobId, target, apiKey: (await resolveSecret(req.sid, `fetcher-${target}`, parsed.data.apiKey))?.value }));
});

/** Deployments being tracked, so polling doesn't need the token resent. In memory only, 30 minute TTL. */
const tracked = new Map<string, { sid: string; token: string; teamId?: string; expires: number; readyAt?: number }>();
/** After READY, wait this long for the public alias before settling for the unique URL. */
const ALIAS_GRACE_MS = 30_000;
const sweep = () => {
  const now = Date.now();
  for (const [id, entry] of tracked) if (entry.expires < now) tracked.delete(id);
};

const DeployBody = z.object({
  poc: PocSchema,
  token: secretField.optional(),
  teamId: z.string().trim().max(100).optional(),
});

app.post("/api/deploy", heavyLimit, async (req, res) => {
  const parsed = DeployBody.safeParse(req.body);
  if (!parsed.success) throw new UserFacingError("There is no valid prototype to deploy. Build one first.");
  const token = await resolveSecret(req.sid, "vercel", parsed.data.token);
  if (!token) throw new UserFacingError("Enter your Vercel token to deploy.", 401);
  const teamId = parsed.data.teamId || config.defaults.vercelTeamId;
  let deployment;
  try {
    deployment = await createDeployment({ poc: normalizePoc(parsed.data.poc), token: token.value, teamId });
  } catch (error) {
    throw explainRejection(error, token.source, { provider: "Vercel", noun: "token", env: "VERCEL_TOKEN" }, token.value);
  }
  sweep();
  tracked.set(deployment.id, { sid: req.sid, token: token.value, teamId, expires: Date.now() + 30 * 60_000 });
  res.json({ deployment });
});

app.get("/api/deploy/:id", async (req, res) => {
  const entry = tracked.get(req.params.id);
  if (!entry || entry.sid !== req.sid) throw new UserFacingError("Unknown deployment.", 404);
  const deployment = await getDeployment({ id: req.params.id, token: entry.token, teamId: entry.teamId });
  if (deployment.status === "READY") {
    entry.readyAt ??= Date.now();
    if (!deployment.aliased && Date.now() - entry.readyAt < ALIAS_GRACE_MS) deployment.status = "FINALIZING";
  }
  if (["READY", "ERROR", "CANCELED"].includes(deployment.status)) tracked.delete(req.params.id);
  res.json({ deployment });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Credentials can appear in upstream error text, so only vetted messages reach the client and nothing is logged.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof UserFacingError) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}), ...(error.usage ? { usage: error.usage } : {}) });
  if ((error as { type?: string })?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  console.error("Unhandled server error:", (error as Error)?.name);
  res.status(500).json({ error: "Something went wrong. Please retry." });
});

