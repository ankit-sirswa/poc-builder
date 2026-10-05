import type { Brief, ModelId, Poc, TokenUsage } from "../shared/schema";

export type Provider = "openai" | "vercel" | "fetcher-local" | "fetcher-production";
export type FetcherTarget = "local" | "production";
export interface CredentialInfo {
  saved: boolean;
  last4?: string;
  savedAt?: string;
  /** The server has a default from .env (the value is never sent to the browser). */
  hasDefault?: boolean;
}
export interface AppConfig {
  models: { id: string; label: string }[];
  defaultModel: string | null;
  hasDefaultTeam: boolean;
  fetcher: {
    defaultTarget: FetcherTarget | null;
    targets: { id: FetcherTarget; configured: boolean; host: string | null }[];
  };
}
export type CredentialStatus = Record<Provider, CredentialInfo>;
export interface Deployment {
  id: string;
  url: string;
  status: string;
  inspectorUrl?: string;
  errorMessage?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Tokens OpenAI billed for a call that still failed. */
    public usage?: TokenUsage,
    /** "key_required" | "invalid_key" | "model_unavailable": lets the UI react without parsing text. */
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and retry.", 0);
  }
  const data = await res.json().catch(() => ({}));
  // The session expired (or the password was changed): hand control back to the sign-in screen.
  if (res.status === 401 && data?.code === "auth_required") window.dispatchEvent(new Event("pb-auth-required"));
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status, data?.usage, data?.code);
  return data as T;
}

export interface FetchedJob {
  brief: Brief;
  meta: { id: string; url: string; tier: string; postedAt: string };
  target: FetcherTarget;
}

export const api = {
  authStatus: () => request<{ required: boolean; authenticated: boolean }>("/auth/status"),
  login: (password: string) => request<{ ok: true }>("/auth/login", "POST", { password }),
  logout: () => request<{ ok: true }>("/auth/logout", "POST", {}),
  models: (payload: { apiKey?: string }) => request<{ models: string[]; unverified?: boolean }>("/models", "POST", payload),
  lookupJob: (payload: { jobId: string; target: FetcherTarget; apiKey?: string }) => request<FetchedJob>("/fetcher/lookup", "POST", payload),
  config: () => request<AppConfig>("/config"),
  credentials: () => request<CredentialStatus>("/credentials"),
  saveCredential: (provider: Provider, value: string) => request<CredentialStatus>(`/credentials/${provider}`, "PUT", { value }),
  removeCredential: (provider: Provider) => request<CredentialStatus>(`/credentials/${provider}`, "DELETE"),
  generate: (payload: Brief & { model: ModelId; apiKey?: string }) => request<{ poc: Poc; usage?: TokenUsage }>("/generate", "POST", payload),
  deploy: (payload: { poc: Poc; token?: string; teamId?: string }) => request<{ deployment: Deployment }>("/deploy", "POST", payload),
  deployment: (id: string) => request<{ deployment: Deployment }>(`/deploy/${encodeURIComponent(id)}`),
};
