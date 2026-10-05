// What a person pastes into the "Job ID" field, reduced to the id Job Fetcher keys
// its jobs on (the Upwork ciphertext). Restated from the monorepo's
// proposal-builder/api/src/jobs/job-id.ts, because the products share no code;
// the two must stay identical so a job Job Fetcher can store is a job we can look up.
function extractJobId(input: string): string | null {
  const tilde = input.match(/~(\w+)/);
  if (tilde) return tilde[1];
  const slash = input.match(/\/(\d{10,})\b/);
  if (slash) return slash[1];
  if (/^\d{10,}$/.test(input)) return input;
  if (/^\w{15,}$/.test(input)) return input;
  return null;
}

/**
 * Accepts a bare id, "~02abc…", or a full Upwork job URL. Anything that isn't
 * path-safe is refused, since the id is interpolated into the Job Fetcher URL.
 */
export function normalizeJobId(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw || raw.length > 512) return null;
  const extracted = extractJobId(raw);
  if (extracted) return extracted;
  return /^[\w-]{1,64}$/.test(raw) ? raw : null;
}
