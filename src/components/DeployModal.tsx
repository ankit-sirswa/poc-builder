import { useEffect, useRef, useState } from "react";
import type { Poc } from "../../shared/schema";
import { ApiError, api, type CredentialInfo, type CredentialStatus, type Deployment } from "../api";
import { CredentialField } from "./CredentialField";
import { TriangleIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  poc: Poc;
  vercel: CredentialInfo;
  hasDefaultTeam: boolean;
  credentialsLoading: boolean;
  onCredentials: (status: CredentialStatus) => void;
  onDeployed: (url: string) => void;
  toast: (message: string) => void;
}

type Phase = "idle" | "working" | "done" | "failed";
interface Result {
  title: string;
  body: string;
  url?: string;
}

const POLL_MS = 2000;
const MAX_POLLS = 90;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function DeployModal({ open, onClose, poc, vercel, hasDefaultTeam, credentialsLoading, onCredentials, onDeployed, toast }: Props) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenPrompt, setTokenPrompt] = useState(0);
  const tokenInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    tokenInput.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    cancelled.current = true;
    setPhase("idle");
    setResult(null);
    setToken("");
    setTokenError(null);
    onClose();
  }

  async function deploy() {
    const typed = token.trim();
    if (!credentialsLoading && !typed && !vercel.saved && !vercel.hasDefault) {
      setTokenError("Enter your Vercel token to deploy.");
      tokenInput.current?.focus();
      return;
    }
    setTokenError(null);
    setPhase("working");
    setResult({ title: "Connecting to Vercel…", body: "Checking your token" });
    try {
      if (typed && remember) onCredentials(await api.saveCredential("vercel", typed));
      const { deployment: created } = await api.deploy({
        poc,
        token: typed && !remember ? typed : undefined,
        teamId: teamId.trim() || undefined,
      });
      setToken("");
      let deployment: Deployment = created;
      setResult({ title: "Building your preview…", body: `Uploaded ${poc.pages.length} pages · status ${deployment.status.toLowerCase()}` });
      for (let polls = 0; deployment.status !== "READY" && polls < MAX_POLLS; polls++) {
        if (["ERROR", "CANCELED"].includes(deployment.status)) break;
        await sleep(POLL_MS);
        if (cancelled.current) return;
        deployment = (await api.deployment(deployment.id)).deployment;
        setResult({ title: "Building your preview…", body: `Status ${deployment.status.toLowerCase()}` });
      }
      if (cancelled.current) return;
      if (deployment.status === "READY") {
        setPhase("done");
        setResult({ title: "Deployed · preview is live", body: "Your shareable preview:", url: deployment.url });
        onDeployed(deployment.url);
      } else {
        setPhase("failed");
        setResult({
          title: deployment.status === "ERROR" ? "Vercel couldn't build the preview" : "Still building",
          body: deployment.errorMessage ?? (deployment.status === "ERROR" ? "Check the deployment in your Vercel dashboard." : "This is taking longer than expected. It may still finish in your Vercel dashboard."),
          url: deployment.inspectorUrl,
        });
      }
    } catch (error) {
      if (cancelled.current) return;
      setPhase("failed");
      setResult({ title: "Deploy failed", body: error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong." });
      if (error instanceof ApiError && error.status === 401) setTokenPrompt((n) => n + 1);
    }
  }

  async function removeToken() {
    try {
      onCredentials(await api.removeCredential("vercel"));
      toast("Saved Vercel token removed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't remove the token.");
    }
  }

  return (
    <div className={`modal-backdrop${open ? " is-open" : ""}`} onClick={(event) => event.target === event.currentTarget && close()}>
      <div className="deploy-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div className="modal-top">
          <div className="modal-icon" aria-hidden="true">
            <TriangleIcon />
          </div>
          <button className="close-button" type="button" onClick={close} aria-label="Close deploy dialog">
            ×
          </button>
        </div>
        <h2 className="modal-title" id="modalTitle">
          Ready for a first share?
        </h2>
        <p className="modal-copy">Connect Vercel to put this prototype on a shareable preview URL. The deployment is created in your Vercel account.</p>
        <CredentialField
          id="vercelKey"
          label="Vercel API token"
          noun="Vercel token"
          placeholder="Paste your Vercel token"
          info={vercel}
          value={token}
          onChange={setToken}
          remember={remember}
          onRememberChange={setRemember}
          onRemove={removeToken}
          error={tokenError}
          errorId="vercelError"
          inputRef={tokenInput}
          loading={credentialsLoading}
          promptSignal={tokenPrompt}
        />
        <details className="field-details">
          <summary>{hasDefaultTeam ? "Team: using the server default (change)" : "Deploying to a team? (optional)"}</summary>
          <input className="text-input" aria-label="Vercel team ID or slug" placeholder={hasDefaultTeam ? "Leave blank for the server default team" : "team_… or team slug"} value={teamId} onChange={(e) => setTeamId(e.target.value)} autoComplete="off" spellCheck={false} />
        </details>
        <p className="security-note">Your token goes only to this app's server over HTTPS and is used to call Vercel. It is never kept in your browser or logged.</p>
        <button className="deploy-submit" type="button" onClick={deploy} disabled={phase === "working"}>
          {phase === "working" ? "Deploying preview…" : phase === "done" ? "Deploy again" : phase === "failed" ? "Try again" : "Connect & deploy preview"}
        </button>
        {result && (
          <div className={`deploy-result is-visible${phase === "failed" ? " is-error" : ""}`} role="status" aria-live="polite">
            <strong>{result.title}</strong>
            {result.body}
            {result.url && (
              <div className="result-actions">
                <a href={result.url} target="_blank" rel="noopener noreferrer">
                  {result.url.replace(/^https?:\/\//, "")} ↗
                </a>
                {phase === "done" && (
                  <button className="text-button" type="button" onClick={() => navigator.clipboard?.writeText(result.url!).then(() => toast("Preview link copied."), () => toast("Couldn't copy the link."))}>
                    Copy link
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <p className="modal-foot">Tokens are encrypted if you choose to save them, and you can remove them any time.</p>
      </div>
    </div>
  );
}
