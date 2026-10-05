import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "./config";
import { UserFacingError } from "./generate";

/**
 * Optional shared-password gate. Off unless APP_PASSWORD is set (local development stays open).
 * When on, every /api call except health and sign-in needs a signed, expiring cookie.
 * The .env keys are usable by anyone who passes this gate, so turn it on for any public deployment.
 */

const COOKIE = "pb_auth";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const required = () => Boolean(config.appPassword);

const sign = (value: string) => crypto.createHmac("sha256", config.sessionSecret!).update(value).digest("base64url");
const digest = (value: string) => crypto.createHash("sha256").update(value).digest();

function issueToken() {
  const expires = String(Date.now() + TTL_MS);
  return `${expires}.${sign(expires)}`;
}

function validToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !(Number(expires) > Date.now())) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const isAuthenticated = (req: Request) => !required() || validToken(req.cookies?.[COOKIE]);

const loginLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const authRouter = Router();

authRouter.get("/status", (req, res) => {
  res.json({ required: required(), authenticated: isAuthenticated(req) });
});

authRouter.post("/login", loginLimit, async (req, res) => {
  if (!required()) return res.json({ ok: true });
  const parsed = z.object({ password: z.string().max(500) }).safeParse(req.body);
  const given = parsed.success ? parsed.data.password : "";
  // Compare digests so the comparison time doesn't depend on how much of the password matched.
  if (!crypto.timingSafeEqual(digest(given), digest(config.appPassword!))) {
    await delay(400);
    throw new UserFacingError("That password isn't right.", 401, undefined, undefined, "bad_password");
  }
  res.cookie(COOKIE, issueToken(), { httpOnly: true, sameSite: "lax", secure: req.secure, maxAge: TTL_MS });
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: req.secure });
  res.json({ ok: true });
});

/** Mounted on /api after the auth router: blocks everything else until signed in. */
export function authGate(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req) || req.path === "/health") return next();
  res.status(401).json({ error: "Sign in required.", code: "auth_required" });
}
