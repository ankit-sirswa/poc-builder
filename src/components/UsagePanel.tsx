import { logTotals, pocTotals, type RunRecord, type UsageLog } from "../lib/usage";

const n = (value: number) => value.toLocaleString("en-US");
const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function RunRow({ run, index }: { run: RunRecord; index: number }) {
  return (
    <li className="usage-run">
      <span className="usage-run-no">#{index + 1}</span>
      <span className={`usage-kind${run.kind === "rerun" ? " is-rerun" : ""}`}>{run.kind === "rerun" ? "Rerun" : "Build"}</span>
      {run.status === "failed" && <span className="usage-failed">Failed</span>}
      <span className="usage-model">{run.model}</span>
      <span className="usage-tokens">{run.usage ? `${n(run.usage.promptTokens)} in · ${n(run.usage.completionTokens)} out · ${n(run.usage.totalTokens)} total` : "tokens n/a"}</span>
      <span className="usage-when">{when(run.at)}</span>
    </li>
  );
}

interface Props {
  log: UsageLog;
  onClear: () => void;
}

export function UsagePanel({ log, onClear }: Props) {
  const totals = logTotals(log);
  return (
    <div className="alternate-view is-visible" role="tabpanel" id="panel-usage" aria-labelledby="tab-usage">
      <p className="eyebrow">Token usage</p>
      <div className="data-list">
        <div className="data-item">
          <span>POCs</span>
          <strong>{n(totals.pocs)}</strong>
        </div>
        <div className="data-item">
          <span>Runs</span>
          <strong>
            {n(totals.runs)} ({n(totals.runs - totals.reruns)} builds · {n(totals.reruns)} reruns)
          </strong>
        </div>
        <div className="data-item">
          <span>Total tokens</span>
          <strong>{n(totals.total)}</strong>
        </div>
        <div className="data-item">
          <span>Input / output</span>
          <strong>
            {n(totals.prompt)} / {n(totals.completion)}
          </strong>
        </div>
      </div>

      {log.pocs.length === 0 ? (
        <p className="usage-empty">No POCs built yet. Tokens are counted each time you press Build POC.</p>
      ) : (
        <div className="usage-list">
          {log.pocs.map((poc) => {
            const t = pocTotals(poc);
            return (
              <details className="usage-poc" key={poc.key}>
                <summary>
                  <span className="usage-poc-title">{poc.title}</span>
                  <span className="usage-poc-meta">
                    {poc.jobId ? `${poc.jobId} · ` : ""}
                    {t.runs} {t.runs === 1 ? "run" : "runs"} · {n(t.total)} tokens
                  </span>
                </summary>
                <ul className="usage-runs">
                  {poc.runs.map((run, i) => (
                    <RunRow key={`${run.at}-${i}`} run={run} index={i} />
                  ))}
                </ul>
                <p className="usage-sub">
                  First built {when(poc.createdAt)} · {n(t.prompt)} in / {n(t.completion)} out
                </p>
              </details>
            );
          })}
        </div>
      )}

      <p className="usage-note">Saved in this browser only (localStorage), so clearing site data erases it. A failed run still counts when OpenAI billed it.</p>
      {log.pocs.length > 0 && (
        <button
          className="text-button"
          type="button"
          onClick={() => {
            if (window.confirm("Clear the token usage history in this browser?")) onClear();
          }}
        >
          Clear history
        </button>
      )}
    </div>
  );
}
