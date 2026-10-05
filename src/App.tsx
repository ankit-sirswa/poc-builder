import { useCallback, useEffect, useRef, useState } from "react";
import { MODELS, type Brief, type ModelId, type Poc } from "../shared/schema";
import { ApiError, api, type AppConfig, type CredentialStatus, type FetcherTarget } from "./api";
import { BriefPanel } from "./components/BriefPanel";
import { DeployModal } from "./components/DeployModal";
import { StagePanel, type View } from "./components/StagePanel";
import { loadState, saveState } from "./lib/storage";
import { EMPTY_LOG, loadUsageLog, pocKey, recordRun, saveUsageLog, type UsageLog } from "./lib/usage";

const STATIC_CONFIG: AppConfig = { models: [...MODELS], defaultModel: null, hasDefaultTeam: false, fetcher: { defaultTarget: null, targets: [] } };
const NO_CREDENTIALS: CredentialStatus = { openai: { saved: false }, vercel: { saved: false }, "fetcher-local": { saved: false }, "fetcher-production": { saved: false } };
const EMPTY_BRIEF: Brief = { jobId: "", title: "", description: "", budget: "", projectType: "", requirements: "" };

export function App({ onSignOut }: { onSignOut?: () => void }) {
  const [initial] = useState(() => loadState());
  const [brief, setBrief] = useState<Brief>({ ...EMPTY_BRIEF, ...initial?.brief });
  const [appConfig, setAppConfig] = useState<AppConfig>(STATIC_CONFIG);
  const [model, setModel] = useState<ModelId>(initial?.model ?? "");
  const [poc, setPoc] = useState<Poc | null>(initial?.poc ?? null);
  const [projectName, setProjectName] = useState(initial?.projectName ?? "");
  const [built, setBuilt] = useState(initial?.built ?? null);
  const [usageLog, setUsageLog] = useState<UsageLog>(() => loadUsageLog());
  const [pageId, setPageId] = useState("home");
  const [view, setView] = useState<View>("preview");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus>(NO_CREDENTIALS);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPrompt, setKeyPrompt] = useState(0);
  /** Models OpenAI says this key can use. null until checked. */
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [modelsUnverified, setModelsUnverified] = useState(false);
  const modelCheckId = useRef(0);
  const [checkingModels, setCheckingModels] = useState(false);
  const [modelsNote, setModelsNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [fetcherTarget, setFetcherTarget] = useState<FetcherTarget | null>(initial?.fetcherTarget === "production" || initial?.fetcherTarget === "local" ? initial.fetcherTarget : null);
  const [fetcherKey, setFetcherKey] = useState("");
  const [rememberFetcherKey, setRememberFetcherKey] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimer = useRef<number>(undefined);
  const keyInput = useRef<HTMLInputElement>(null);

  const toast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastVisible(false), 2400);
  }, []);

  useEffect(() => {
    api.credentials().then(setCredentials, () => undefined).finally(() => setCredentialsReady(true));
    api.config().then((cfg) => {
      setAppConfig(cfg);
      // Keep the remembered source if it's still configured, else the .env default, else the first configured one.
      setFetcherTarget((current) => {
        const usable = cfg.fetcher.targets.filter((t) => t.configured).map((t) => t.id);
        return current && usable.includes(current) ? current : cfg.fetcher.defaultTarget ?? usable[0] ?? null;
      });
    }, () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveUsageLog(usageLog);
  }, [usageLog]);

  useEffect(() => {
    saveState({ brief, model, poc, projectName, built, fetcherTarget: fetcherTarget ?? undefined });
  }, [brief, model, poc, projectName, built, fetcherTarget]);

  const PREFERRED_MODELS = ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o"];

  /**
   * Asks OpenAI which chat models this key can use (a free call) and offers only those, so the model list is
   * never a guess. `quiet` is for automatic checks: a bad key is shown at the key field but doesn't steal focus.
   */
  async function checkModels(quiet = false) {
    const typed = openaiKey.trim();
    const haveKey = typed || credentials.openai.saved || credentials.openai.hasDefault;
    if (!haveKey) {
      if (!quiet) {
        setKeyError("Enter your OpenAI API key to continue.");
        keyInput.current?.focus();
      }
      return;
    }
    const ticket = ++modelCheckId.current;
    setCheckingModels(true);
    setModelsNote(null);
    try {
      const { models, unverified } = await api.models({ apiKey: typed || undefined });
      if (ticket !== modelCheckId.current) return; // a newer check superseded this one
      // A key barred from listing models can still use them: fall back to the common ones and let OpenAI decide.
      const list = unverified ? appConfig.models.map((m) => m.id) : models;
      setAvailableModels(list);
      setModelsUnverified(Boolean(unverified));
      setKeyError(null);
      if (list.length === 0) {
        setModel("");
        setModelsNote({ kind: "error", text: "OpenAI lists no compatible chat models for this key. Check the project's model access at platform.openai.com." });
        return;
      }
      setModel((current) =>
        list.includes(current) ? current : appConfig.defaultModel && list.includes(appConfig.defaultModel) ? appConfig.defaultModel : (PREFERRED_MODELS.find((id) => list.includes(id)) ?? list[0]),
      );
      setModelsNote(
        unverified
          ? { kind: "info", text: "This key isn't allowed to list models, so these are the common ones. If a build says a model isn't available, pick another." }
          : { kind: "info", text: `${list.length} model${list.length === 1 ? "" : "s"} enabled for your key.` },
      );
    } catch (error) {
      if (ticket !== modelCheckId.current) return;
      setAvailableModels(null);
      setModel("");
      if (error instanceof ApiError && (error.code === "invalid_key" || error.code === "key_required")) {
        setKeyError(error.message);
        if (!quiet) setKeyPrompt((n) => n + 1);
      } else {
        setModelsNote({ kind: "error", text: error instanceof Error ? error.message : "Couldn't check the models. Please retry." });
      }
    } finally {
      if (ticket === modelCheckId.current) setCheckingModels(false);
    }
  }

  // Check automatically: once a key is available (.env default or saved) and shortly after one is typed.
  useEffect(() => {
    if (!credentialsReady) return;
    const typed = openaiKey.trim();
    if (!typed && !credentials.openai.saved && !credentials.openai.hasDefault) {
      modelCheckId.current++;
      setAvailableModels(null);
      setModel("");
      setModelsNote(null);
      setCheckingModels(false);
      return;
    }
    if (typed && typed.length < 16) return; // still typing
    const timer = window.setTimeout(() => void checkModels(true), typed ? 700 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialsReady, openaiKey, credentials.openai.saved, credentials.openai.hasDefault, credentials.openai.savedAt]);

  async function build() {
    const title = brief.title.trim();
    const description = brief.description.trim();
    if (!title || !description) {
      toast("Add a job title and description to build a prototype.");
      return;
    }
    const typed = openaiKey.trim();
    if (credentialsReady && !typed && !credentials.openai.saved && !credentials.openai.hasDefault) {
      setKeyError("Enter your OpenAI API key to continue.");
      keyInput.current?.focus();
      return;
    }
    if (!model) {
      setBuildError(checkingModels ? "Still checking which models your key can use. Try again in a moment." : "Pick a model first. Add a working OpenAI key so I can see which models it can use.");
      return;
    }
    setKeyError(null);
    setBuildError(null);
    setBuilding(true);
    try {
      if (typed && rememberKey) setCredentials(await api.saveCredential("openai", typed));
      const { poc: generated, usage } = await api.generate({ ...brief, title, description, model, apiKey: typed && !rememberKey ? typed : undefined });
      const run = recordRun(usageLog, { key: pocKey({ jobId: brief.jobId, title }), jobId: brief.jobId, title, model, at: new Date().toISOString(), status: "ok", usage: usage ?? null });
      setUsageLog(run.log);
      setOpenaiKey("");
      setPoc(generated);
      setProjectName(title);
      setBuilt({ model, run: run.runNumber, tokens: usage?.totalTokens });
      setDeployedUrl(null);
      setPageId("home");
      setView("preview");
      toast(`POC built with ${model}${usage ? ` · ${usage.totalTokens.toLocaleString("en-US")} tokens` : ""}${run.kind === "rerun" ? ` (rerun, run ${run.runNumber})` : ""}.`);
    } catch (error) {
      let message = error instanceof Error ? error.message : "Build failed. Please retry.";
      // The call reached OpenAI and was billed even though it gave no usable site: count it.
      if (error instanceof ApiError && error.usage) {
        setUsageLog(recordRun(usageLog, { key: pocKey({ jobId: brief.jobId, title }), jobId: brief.jobId, title, model, at: new Date().toISOString(), status: "failed", usage: error.usage }).log);
        message += ` (${error.usage.totalTokens.toLocaleString("en-US")} tokens were used.)`;
      }
      // Route by the server's error code: a bad key belongs at the key field, a model the key can't use triggers a model check.
      if (error instanceof ApiError && (error.code === "invalid_key" || error.code === "key_required" || error.status === 401)) {
        setKeyError(message);
        setKeyPrompt((n) => n + 1);
      } else {
        setBuildError(message);
        if (error instanceof ApiError && error.code === "model_unavailable") void checkModels();
      }
    } finally {
      setBuilding(false);
    }
  }

  async function fetchJob() {
    const id = brief.jobId.trim();
    if (!id) {
      setFetchError("Paste an Upwork job ID or URL first.");
      return;
    }
    if (!fetcherTarget) return;
    const provider = `fetcher-${fetcherTarget}` as const;
    setFetchError(null);
    setFetchNote(null);
    setFetching(true);
    try {
      const typed = fetcherKey.trim();
      if (typed && rememberFetcherKey) setCredentials(await api.saveCredential(provider, typed));
      const { brief: imported, meta } = await api.lookupJob({ jobId: id, target: fetcherTarget, apiKey: typed && !rememberFetcherKey ? typed : undefined });
      setBrief(imported);
      setFetcherKey("");
      setFetchNote(`Imported from Job Fetcher (${fetcherTarget})${meta.tier ? ` · tier ${meta.tier}` : ""}. Review the fields, then build.`);
      toast("Job imported from Job Fetcher.");
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Couldn't fetch the job. Please retry.");
    } finally {
      setFetching(false);
    }
  }

  async function removeFetcherKey() {
    try {
      if (!fetcherTarget) return;
      setCredentials(await api.removeCredential(`fetcher-${fetcherTarget}`));
      toast("Saved Job Fetcher key removed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't remove the key.");
    }
  }

  async function removeOpenaiKey() {
    try {
      setCredentials(await api.removeCredential("openai"));
      toast("Saved OpenAI key removed.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't remove the key.");
    }
  }

  function clearBrief() {
    setBrief(EMPTY_BRIEF);
    setFetchError(null);
    setFetchNote(null);
    setBuildError(null);
  }

  const labelFor = (id: string) => appConfig.models.find((m) => m.id === id)?.label ?? id;
  const modelOptions = (availableModels ?? []).map((id) => ({ id, label: labelFor(id) }));

  const subtitle = built
    ? `Built with ${built.model} · ${poc?.pages.length ?? 0} pages${built.run && built.run > 1 ? ` · run ${built.run}` : ""}${built.tokens ? ` · ${built.tokens.toLocaleString("en-US")} tokens` : ""}`
    : "Nothing built yet";

  return (
    <>
      <header className="topbar shell">
        <a className="brand" href="/" aria-label="draftwork home">
          <span className="brand-mark">d</span>draftwork
        </a>
        <div className="topbar-right">
          <div className="workspace-label">
            <span className="workspace-dot" />
            Personal workspace <span aria-hidden="true">⌄</span>
          </div>
          {onSignOut && (
            <button className="text-button" type="button" onClick={onSignOut}>
              Sign out
            </button>
          )}
          <div className="avatar" aria-label="Account">
            S
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="intro">
          <div>
            <p className="eyebrow">A little less blank canvas</p>
            <h1>
              From job brief to
              <br />
              first click-through.
            </h1>
          </div>
          <p className="intro-note">Paste an Upwork post. Get a client-ready starting point you can click through, tune, and share.</p>
        </section>

        <section className="workspace" aria-label="Prototype builder">
          <BriefPanel
            brief={brief}
            onBriefChange={(patch) => {
              setBrief((b) => ({ ...b, ...patch }));
              if ("jobId" in patch) {
                setFetchError(null);
                setFetchNote(null);
              }
            }}
            fetcherTargets={appConfig.fetcher.targets}
            fetcherTarget={fetcherTarget}
            onFetcherTargetChange={(target) => {
              setFetcherTarget(target);
              // A key typed for one environment must never be sent to the other.
              setFetcherKey("");
              setRememberFetcherKey(false);
              setFetchError(null);
              setFetchNote(null);
            }}
            fetcher={fetcherTarget ? credentials[`fetcher-${fetcherTarget}`] : { saved: false }}
            fetcherKey={fetcherKey}
            onFetcherKeyChange={setFetcherKey}
            rememberFetcherKey={rememberFetcherKey}
            onRememberFetcherKeyChange={setRememberFetcherKey}
            onRemoveFetcherKey={removeFetcherKey}
            fetching={fetching}
            fetchError={fetchError}
            fetchNote={fetchNote}
            onFetchJob={fetchJob}
            onClearBrief={clearBrief}
            models={modelOptions}
            onCheckModels={() => void checkModels(false)}
            checkingModels={checkingModels}
            modelsUnverified={modelsUnverified}
            modelsLoaded={availableModels !== null}
            modelsNote={modelsNote}
            model={model}
            onModelChange={setModel}
            openai={credentials.openai}
            openaiKey={openaiKey}
            onOpenaiKeyChange={(value) => {
              setOpenaiKey(value);
              setKeyError(null);
            }}
            rememberKey={rememberKey}
            onRememberKeyChange={setRememberKey}
            onRemoveKey={removeOpenaiKey}
            keyError={keyError}
            keyPrompt={keyPrompt}
            credentialsLoading={!credentialsReady}
            keyInputRef={keyInput}
            building={building}
            buildError={buildError}
            onBuild={build}
          />
          <StagePanel
            poc={poc}
            projectName={projectName}
            subtitle={subtitle}
            deployedUrl={deployedUrl}
            saved={building ? "Building…" : "All changes saved"}
            building={building}
            buildingModel={model}
            pageId={pageId}
            onPageChange={setPageId}
            view={view}
            onViewChange={setView}
            onDeploy={() => setDeployOpen(true)}
            usageLog={usageLog}
            onClearUsage={() => setUsageLog(EMPTY_LOG)}
          />
        </section>
      </main>

      <div className={`toast${toastVisible ? " is-visible" : ""}`} role="status" aria-live="polite">
        {toastMessage}
      </div>

      {poc && (
      <DeployModal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        poc={poc}
        vercel={credentials.vercel}
        hasDefaultTeam={appConfig.hasDefaultTeam}
        credentialsLoading={!credentialsReady}
        onCredentials={setCredentials}
        onDeployed={setDeployedUrl}
        toast={toast}
      />
      )}
    </>
  );
}
