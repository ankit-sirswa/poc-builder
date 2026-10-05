import { renderSiteFiles } from "../shared/render";
import { slugify, type Poc } from "../shared/schema";
import { config } from "./config";
import { UserFacingError } from "./generate";

export interface DeploymentInfo {
  id: string;
  url: string;
  /** QUEUED | INITIALIZING | BUILDING | READY | ERROR | CANCELED */
  status: string;
  inspectorUrl?: string;
  errorMessage?: string;
  /** True once Vercel has attached the public production alias. */
  aliased?: boolean;
}

function endpoint(path: string, teamId?: string) {
  const url = new URL(path, config.vercelApiBase);
  if (teamId) url.searchParams.set(/^team_/.test(teamId) ? "teamId" : "slug", teamId);
  return url;
}

async function call(url: URL, token: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new UserFacingError("Couldn't reach Vercel. Check your connection and retry.", 502);
  }
  const body = (await res.json().catch(() => ({}))) as any;
  if (res.ok) return body;
  if (res.status === 401 || res.status === 403) {
    throw new UserFacingError("Vercel rejected the token. Check it has deploy access (and the team, if any) and try again.", 401, undefined, "it may be revoked, expired, or lack access to that team", "invalid_key");
  }
  if (res.status === 429) throw new UserFacingError("Vercel rate limit reached. Wait a moment and retry.", 429);
  const message = typeof body?.error?.message === "string" ? body.error.message.slice(0, 300) : `status ${res.status}`;
  throw new UserFacingError(`Vercel couldn't create the deployment: ${message}`, 502);
}

/**
 * Prefer the production alias (`<project>.vercel.app`). Vercel's default
 * deployment protection can put a login wall in front of the unique
 * per-deployment URL, while the production alias stays public and shareable.
 */
const toInfo = (body: any): DeploymentInfo => {
  const alias = Array.isArray(body.alias) ? body.alias.find((a: unknown) => typeof a === "string") : undefined;
  const host = alias ?? body.url;
  return {
    id: body.id,
    url: host ? `https://${host}` : "",
    status: String(body.readyState ?? body.status ?? "QUEUED").toUpperCase(),
    inspectorUrl: body.inspectorUrl,
    errorMessage: body.errorMessage ?? body.error?.message,
    aliased: Boolean(alias),
  };
};

export async function createDeployment(args: { poc: Poc; token: string; teamId?: string }): Promise<DeploymentInfo> {
  const url = endpoint("/v13/deployments", args.teamId);
  url.searchParams.set("skipAutoDetectionConfirmation", "1");
  const body = await call(url, args.token, {
    method: "POST",
    body: JSON.stringify({
      name: `poc-${slugify(args.poc.site.name, "site")}`,
      files: renderSiteFiles(args.poc).map((f) => ({ file: f.file, data: f.data, encoding: "utf-8" })),
      projectSettings: { framework: null },
      // Production deployments aren't behind Vercel's preview protection, so the link is shareable.
      target: "production",
    }),
  });
  return toInfo(body);
}

export async function getDeployment(args: { id: string; token: string; teamId?: string }): Promise<DeploymentInfo> {
  return toInfo(await call(endpoint(`/v13/deployments/${encodeURIComponent(args.id)}`, args.teamId), args.token));
}
