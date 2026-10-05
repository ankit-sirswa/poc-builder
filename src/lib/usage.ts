import type { TokenUsage } from "../../shared/schema";

/**
 * Token usage per POC, kept in this browser's localStorage until there is a database.
 * A POC is one job; building the same job again is a rerun of that POC.
 */

export interface RunRecord {
  at: string;
  kind: "build" | "rerun";
  /** A failed run still cost tokens when the call reached OpenAI. */
  status: "ok" | "failed";
  model: string;
  usage: TokenUsage | null;
}

export interface PocRecord {
  key: string;
  jobId: string;
  title: string;
  createdAt: string;
  runs: RunRecord[];
}

export interface UsageLog {
  pocs: PocRecord[];
}

export const EMPTY_LOG: UsageLog = { pocs: [] };
const STORAGE_KEY = "draftwork:usage:v1";
const MAX_POCS = 200;
const MAX_RUNS = 200;

/** Same job -> same POC. Prefers the Upwork job id, so a pasted URL and a bare id match. */
export function pocKey(brief: { jobId: string; title: string }): string {
  const id = brief.jobId.match(/~(\w+)/)?.[1] ?? brief.jobId.trim();
  if (id) return `job:${id.toLowerCase()}`;
  return `title:${brief.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export interface NewRun {
  key: string;
  jobId: string;
  title: string;
  model: string;
  at: string;
  status: "ok" | "failed";
  usage: TokenUsage | null;
}

/** Adds a run to its POC (creating it on the first build). Most recently used POC first. */
export function recordRun(log: UsageLog, run: NewRun): { log: UsageLog; kind: RunRecord["kind"]; runNumber: number } {
  const existing = log.pocs.find((p) => p.key === run.key);
  const kind: RunRecord["kind"] = existing && existing.runs.length > 0 ? "rerun" : "build";
  const record: RunRecord = { at: run.at, kind, status: run.status, model: run.model, usage: run.usage };
  const poc: PocRecord = {
    key: run.key,
    jobId: run.jobId.trim() || existing?.jobId || "",
    title: run.title.trim() || existing?.title || "Untitled",
    createdAt: existing?.createdAt ?? run.at,
    runs: [...(existing?.runs ?? []), record].slice(-MAX_RUNS),
  };
  const others = log.pocs.filter((p) => p.key !== run.key);
  return { log: { pocs: [poc, ...others].slice(0, MAX_POCS) }, kind, runNumber: poc.runs.length };
}

const sum = (runs: RunRecord[], pick: (u: TokenUsage) => number) => runs.reduce((n, r) => n + (r.usage ? pick(r.usage) : 0), 0);

export function pocTotals(poc: PocRecord) {
  return {
    runs: poc.runs.length,
    prompt: sum(poc.runs, (u) => u.promptTokens),
    completion: sum(poc.runs, (u) => u.completionTokens),
    total: sum(poc.runs, (u) => u.totalTokens),
  };
}

export function logTotals(log: UsageLog) {
  const all = log.pocs.flatMap((p) => p.runs);
  return {
    pocs: log.pocs.length,
    runs: all.length,
    reruns: all.filter((r) => r.kind === "rerun").length,
    prompt: sum(all, (u) => u.promptTokens),
    completion: sum(all, (u) => u.completionTokens),
    total: sum(all, (u) => u.totalTokens),
  };
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

/** Rebuilds a log from untrusted stored JSON, dropping anything malformed. */
export function parseUsageLog(raw: unknown): UsageLog {
  const pocs = Array.isArray((raw as UsageLog)?.pocs) ? (raw as UsageLog).pocs : [];
  return {
    pocs: pocs
      .filter((p) => p && typeof p === "object" && typeof p.key === "string" && Array.isArray(p.runs))
      .slice(0, MAX_POCS)
      .map((p) => ({
        key: p.key,
        jobId: text(p.jobId),
        title: text(p.title, "Untitled"),
        createdAt: text(p.createdAt),
        runs: p.runs
          .filter((r: RunRecord) => r && typeof r === "object")
          .slice(-MAX_RUNS)
          .map((r: RunRecord) => ({
            at: text(r.at),
            kind: r.kind === "rerun" ? ("rerun" as const) : ("build" as const),
            status: r.status === "failed" ? ("failed" as const) : ("ok" as const),
            model: text(r.model),
            usage: r.usage
              ? { promptTokens: count(r.usage.promptTokens), completionTokens: count(r.usage.completionTokens), totalTokens: count(r.usage.totalTokens) }
              : null,
          })),
      })),
  };
}

export function loadUsageLog(): UsageLog {
  try {
    return parseUsageLog(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return EMPTY_LOG;
  }
}

export function saveUsageLog(log: UsageLog) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable or full: the log just isn't kept */
  }
}
