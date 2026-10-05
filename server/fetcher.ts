import type { Brief } from "../shared/schema";
import { config, type FetcherTarget } from "./config";
import { UserFacingError } from "./generate";
import { normalizeJobId } from "./job-id";

export interface FetchedJobMeta {
  id: string;
  url: string;
  tier: string;
  postedAt: string;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown) => {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Job Fetcher stores lists as arrays, JSON strings or comma text, with strings or {name|question} objects inside. */
function list(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => (typeof item === "string" ? item : text((item as any)?.name ?? (item as any)?.question ?? (item as any)?.text ?? (item as any)?.label)))
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatBudget(job: Record<string, any>): string {
  let budget = text(job.budget);
  if (!budget) {
    const min = num(job.budget_min);
    const max = num(job.budget_max);
    const rate = text(job.hourly_rate);
    if (min && max && min !== max) budget = `${money(min)}–${money(max)}`;
    else if (min || max) budget = money((min ?? max)!);
    else if (rate) budget = /^[\d.\s–-]+$/.test(rate) ? `$${rate}/hr` : rate;
  }
  const type = text(job.budget_type).toLowerCase();
  if (budget && (type === "hourly" || type === "fixed") && !budget.toLowerCase().includes(type === "hourly" ? "hr" : "fixed")) {
    budget += ` (${type})`;
  }
  return budget;
}

/** Everything useful for choosing pages that doesn't have its own brief field. */
function requirementsFrom(job: Record<string, any>): string {
  const lines: string[] = [];
  const skills = list(job.skills);
  if (skills.length) lines.push(`Skills: ${skills.join(", ")}`);
  const facts: [string, string][] = [
    ["Experience level", text(job.experience_level)],
    ["Duration", text(job.duration)],
    ["Hours per week", text(job.hours_per_week)],
    ["Engagement", text(job.project_type)],
    ["Client", [text(job.client_name), text(job.client_location)].filter(Boolean).join(", ")],
  ];
  for (const [label, value] of facts) if (value) lines.push(`${label}: ${value}`);
  const questions = list(job.screening_questions);
  if (questions.length) lines.push("Screening questions the client asks:", ...questions.map((q) => `- ${q}`));
  return lines.join("\n");
}

/** Maps a Job Fetcher job (GET /api/jobs/:id) onto the brief form. Exported for tests. */
export function mapJobToBrief(job: Record<string, any>, fallbackId: string): { brief: Brief; meta: FetchedJobMeta } {
  const id = text(job.id) || fallbackId;
  return {
    brief: {
      jobId: id,
      title: text(job.title).slice(0, 300),
      description: text(job.description).slice(0, 20000),
      budget: formatBudget(job).slice(0, 120),
      projectType: (text(job.category) || text(job.project_type)).slice(0, 120),
      requirements: requirementsFrom(job).slice(0, 5000),
    },
    meta: { id, url: text(job.url), tier: text(job.tier), postedAt: text(job.posted_at) },
  };
}

/** Looks up one job. Failures are typed so "no such job" never reads like "couldn't check". */
export async function lookupJob(args: { jobId: unknown; target: FetcherTarget; apiKey?: string }) {
  const base = config.fetcher.targets[args.target].url;
  if (!base) {
    const variable = args.target === "local" ? "JOB_FETCHER_LOCAL_URL" : "JOB_FETCHER_PROD_URL";
    throw new UserFacingError(`Job Fetcher (${args.target}) isn't configured. Set ${variable} in .env, pick the other source, or fill the brief in by hand.`, 503);
  }
  const id = normalizeJobId(args.jobId);
  if (!id) throw new UserFacingError("That doesn't look like an Upwork job ID. Paste the ID or the job URL.", 400);

  let res: Response;
  try {
    res = await fetch(`${base}/api/jobs/${encodeURIComponent(id)}`, {
      headers: args.apiKey ? { "X-API-Key": args.apiKey } : {},
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new UserFacingError(`Couldn't reach Job Fetcher (${args.target}). Check that it's running and the URL in .env is right.`, 503);
  }
  if (res.status === 404) throw new UserFacingError(`That job isn't in Job Fetcher (${args.target}) yet. Fill the brief in by hand.`, 404);
  if (res.status === 401 || res.status === 403) {
    throw new UserFacingError(`Job Fetcher (${args.target}) rejected the API key. Check the key in .env, or use your own key.`, 502);
  }
  if (!res.ok) throw new UserFacingError(`Job Fetcher answered with an error (${res.status}). Please retry.`, 502);

  const job = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!job || typeof job !== "object" || !text(job.title)) {
    throw new UserFacingError("Job Fetcher returned a job with no title. Fill the brief in by hand.", 502);
  }
  return { ...mapJobToBrief(job, id), target: args.target };
}
