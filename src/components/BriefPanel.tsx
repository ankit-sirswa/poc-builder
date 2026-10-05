import { useEffect, useState, type RefObject } from "react";
import type { Brief, ModelId } from "../../shared/schema";
import type { CredentialInfo, FetcherTarget } from "../api";
import { CredentialField } from "./CredentialField";
import { SparkIcon } from "./Icons";

interface Props {
  brief: Brief;
  onBriefChange: (patch: Partial<Brief>) => void;
  onClearBrief: () => void;
  fetcherTargets: { id: FetcherTarget; configured: boolean; host: string | null }[];
  fetcherTarget: FetcherTarget | null;
  onFetcherTargetChange: (target: FetcherTarget) => void;
  fetcher: CredentialInfo;
  fetcherKey: string;
  onFetcherKeyChange: (value: string) => void;
  rememberFetcherKey: boolean;
  onRememberFetcherKeyChange: (value: boolean) => void;
  onRemoveFetcherKey: () => void;
  fetching: boolean;
  fetchError: string | null;
  fetchNote: string | null;
  onFetchJob: () => void;
  models: { id: string; label: string }[];
  onCheckModels: () => void;
  checkingModels: boolean;
  modelsUnverified: boolean;
  modelsLoaded: boolean;
  modelsNote: { kind: "info" | "error"; text: string } | null;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  openai: CredentialInfo;
  openaiKey: string;
  onOpenaiKeyChange: (value: string) => void;
  rememberKey: boolean;
  onRememberKeyChange: (value: boolean) => void;
  onRemoveKey: () => void;
  keyError: string | null;
  keyPrompt: number;
  credentialsLoading: boolean;
  keyInputRef: RefObject<HTMLInputElement | null>;
  building: boolean;
  buildError: string | null;
  onBuild: () => void;
}

const TARGET_LABEL: Record<FetcherTarget, string> = { local: "Local", production: "Production" };
const TARGET_VARIABLE: Record<FetcherTarget, string> = { local: "JOB_FETCHER_LOCAL_URL", production: "JOB_FETCHER_PROD_URL" };

export function BriefPanel(p: Props) {
  const { brief } = p;
  const fetcherConfigured = p.fetcherTarget !== null;
  const activeHost = p.fetcherTargets.find((t) => t.id === p.fetcherTarget)?.host;
  // A rejected key is fixed in the key section, so open it rather than leave it hidden.
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    if (p.fetchError?.includes("rejected the API key")) setKeyOpen(true);
  }, [p.fetchError]);
  return (
    <aside className="brief-panel">
      <div className="panel-kicker">
        <div className="section-label">
          <span className="step-number">01</span>PROJECT BRIEF
        </div>
        <button className="text-button" type="button" onClick={p.onClearBrief} disabled={!Object.values(brief).some((v) => v.trim())}>
          Clear
        </button>
      </div>

      <label className="field-label" htmlFor="jobId">
        Upwork job ID
      </label>
      <div className="id-row">
        <input
          className="text-input"
          id="jobId"
          value={brief.jobId}
          onChange={(e) => p.onBriefChange({ jobId: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && fetcherConfigured) {
              e.preventDefault();
              p.onFetchJob();
            }
          }}
          placeholder="Paste the job ID or URL"
          autoComplete="off"
          spellCheck={false}
          maxLength={512}
          aria-describedby="fetchStatus"
        />
        <button className="fetch-button" type="button" onClick={p.onFetchJob} disabled={p.fetching || !fetcherConfigured} title={fetcherConfigured ? "Fill the brief from Job Fetcher" : "Job Fetcher isn't configured"}>
          {p.fetching ? "Fetching…" : "Fetch"}
        </button>
      </div>
      {fetcherConfigured && (
        <div className="fetch-source">
          <span className="fetch-source-label">Fetch from</span>
          <div className="device-toggle" role="group" aria-label="Job Fetcher source">
            {p.fetcherTargets.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={p.fetcherTarget === t.id}
                disabled={!t.configured}
                onClick={() => p.onFetcherTargetChange(t.id)}
                title={t.configured ? (t.host ?? "") : `Set ${TARGET_VARIABLE[t.id]} in .env to enable`}
              >
                {TARGET_LABEL[t.id]}
              </button>
            ))}
          </div>
          {activeHost && <span className="fetch-host">{activeHost}</span>}
        </div>
      )}
      <div id="fetchStatus">
        {p.fetchError && (
          <p className="field-error is-visible" role="alert">
            {p.fetchError}
          </p>
        )}
        {p.fetchNote && (
          <p className="fetch-note" role="status">
            {p.fetchNote}
          </p>
        )}
        {!fetcherConfigured && p.fetcherTargets.length > 0 && <p className="key-demo-note">Set JOB_FETCHER_LOCAL_URL or JOB_FETCHER_PROD_URL in .env to fill the brief from Job Fetcher. You can still type it in.</p>}
      </div>
      {fetcherConfigured && (
        <details className="field-details" open={keyOpen} onToggle={(e) => setKeyOpen(e.currentTarget.open)}>
          <summary>Job Fetcher key ({TARGET_LABEL[p.fetcherTarget!].toLowerCase()}){p.fetcher.hasDefault ? " (using the server default)" : p.fetcher.saved ? " (saved)" : ""}</summary>
          <CredentialField
            key={p.fetcherTarget}
            id="fetcherKey"
            label="Job Fetcher API key"
            noun="Job Fetcher key"
            placeholder="API key"
            info={p.fetcher}
            value={p.fetcherKey}
            onChange={p.onFetcherKeyChange}
            remember={p.rememberFetcherKey}
            onRememberChange={p.onRememberFetcherKeyChange}
            onRemove={p.onRemoveFetcherKey}
          />
        </details>
      )}
      <label className="field-label" htmlFor="jobTitle">
        Upwork job title
      </label>
      <input className="text-input" id="jobTitle" placeholder="Paste the job title" value={brief.title} onChange={(e) => p.onBriefChange({ title: e.target.value })} autoComplete="off" maxLength={300} />
      <label className="field-label" htmlFor="jobBrief">
        Job description
      </label>
      <textarea className="brief-input" id="jobBrief" placeholder="Paste the job description" value={brief.description} onChange={(e) => p.onBriefChange({ description: e.target.value })} maxLength={20000} />
      <div className="field-hint">
        <span>Paste the client post or your own notes</span>
        <span>{brief.description.length.toLocaleString()} chars</span>
      </div>
      <div className="meta-row">
        <div className="meta-box">
          <span>
            <label htmlFor="budget">Budget</label>
          </span>
          <input id="budget" value={brief.budget} onChange={(e) => p.onBriefChange({ budget: e.target.value })} autoComplete="off" maxLength={120} />
        </div>
        <div className="meta-box">
          <span>
            <label htmlFor="projectType">Project type</label>
          </span>
          <input id="projectType" value={brief.projectType} onChange={(e) => p.onBriefChange({ projectType: e.target.value })} autoComplete="off" maxLength={120} />
        </div>
      </div>
      <label className="field-label" htmlFor="requirements" style={{ marginTop: 14 }}>
        Extra client requirements <span style={{ color: "#a0a098", fontWeight: 400 }}>(optional)</span>
      </label>
      <textarea className="brief-input is-short" id="requirements" value={brief.requirements} onChange={(e) => p.onBriefChange({ requirements: e.target.value })} placeholder="Anything else the client asked for" maxLength={5000} />

      <div className="divider" />
      <div className="section-label" style={{ marginBottom: 12 }}>
        02&nbsp; OPENAI SETUP
      </div>
      <CredentialField
        id="openaiKey"
        label="OpenAI API key"
        noun="OpenAI key"
        placeholder="sk-…"
        info={p.openai}
        value={p.openaiKey}
        onChange={p.onOpenaiKeyChange}
        remember={p.rememberKey}
        onRememberChange={p.onRememberKeyChange}
        onRemove={p.onRemoveKey}
        error={p.keyError}
        errorId="openaiError"
        inputRef={p.keyInputRef}
        loading={p.credentialsLoading}
        promptSignal={p.keyPrompt}
      />
      <label className="field-label" htmlFor="modelSelect">
        Choose a model
      </label>
      <select className="model-select" id="modelSelect" value={p.model} disabled={p.models.length === 0} onChange={(e) => p.onModelChange(e.target.value as ModelId)}>
        {p.models.length === 0 ? (
          <option value="">{p.checkingModels ? "Checking which models your key can use…" : p.modelsLoaded ? "No models available" : "Add a working key to load models"}</option>
        ) : (
          p.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))
        )}
      </select>
      <button className="text-button" type="button" onClick={p.onCheckModels} disabled={p.checkingModels} style={{ marginBottom: 8 }}>
        {p.checkingModels ? "Checking…" : "Refresh the model list"}
      </button>
      {p.modelsNote && (
        <p className={p.modelsNote.kind === "error" ? "field-error is-visible" : "fetch-note"} role={p.modelsNote.kind === "error" ? "alert" : "status"} id="modelsNote">
          {p.modelsNote.text}
        </p>
      )}
      <p className="key-demo-note">Your key is sent only to this app's server over HTTPS to call OpenAI. It is never kept in your browser or logged.</p>

      <div className="divider" />
      <div className="section-label" style={{ marginBottom: 12 }}>
        GENERATED STARTING POINT
      </div>
      <ul className="output-list">
        {["Responsive landing page", "Pages shaped by your brief", "Sample content and imagery"].map((item) => (
          <li key={item}>
            <span className="check">✓</span>
            {item}
          </li>
        ))}
      </ul>
      {p.buildError && (
        <p className="build-error" role="alert">
          {p.buildError}
        </p>
      )}
      <button className="build-button" type="button" onClick={p.onBuild} disabled={p.building || !p.model}>
        <SparkIcon className={p.building ? "spin" : undefined} />
        {p.building ? "Building…" : "Build POC"}
      </button>
    </aside>
  );
}
