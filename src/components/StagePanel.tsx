import { useCallback, useState, type ReactElement } from "react";
import type { Poc } from "../../shared/schema";
import { DesktopIcon, PhoneIcon, TabletIcon, UploadIcon } from "./Icons";
import type { UsageLog } from "../lib/usage";
import { SitePreview, type Device } from "./SitePreview";
import { UsagePanel } from "./UsagePanel";

export type View = "preview" | "pages" | "content" | "usage";

interface Props {
  poc: Poc | null;
  projectName: string;
  subtitle: string;
  deployedUrl: string | null;
  saved: string;
  building: boolean;
  buildingModel: string;
  pageId: string;
  onPageChange: (pageId: string) => void;
  view: View;
  onViewChange: (view: View) => void;
  onDeploy: () => void;
  usageLog: UsageLog;
  onClearUsage: () => void;
}

const DEVICES: { id: Device; label: string; icon: ReactElement }[] = [
  { id: "desktop", label: "Desktop", icon: <DesktopIcon /> },
  { id: "tablet", label: "Tablet", icon: <TabletIcon /> },
  { id: "mobile", label: "Mobile", icon: <PhoneIcon /> },
];

export function StagePanel(p: Props) {
  const { poc } = p;
  const [device, setDevice] = useState<Device>("desktop");
  const pageTitle = poc?.pages.find((page) => page.id === p.pageId)?.title ?? "Home";
  const navigate = useCallback(
    (pageId: string) => {
      p.onPageChange(pageId);
      p.onViewChange("preview");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onPageChange, p.onViewChange],
  );

  const hint =
    p.view === "usage"
      ? "Tokens used by each POC build and rerun, kept in this browser."
      : !poc
        ? "Fill in the brief, then press Build POC."
        : p.view === "preview"
          ? `${pageTitle} page · click around the preview to explore the generated site.`
          : p.view === "pages"
            ? `${poc.pages.length} responsive pages mapped from the client brief.`
            : "Generated content is placeholder copy and can be replaced with the client's real details.";
  const tabs: { id: View; label: string; count?: number }[] = [
    { id: "preview", label: "Preview" },
    { id: "pages", label: "Pages", count: poc?.pages.length },
    { id: "content", label: "Content" },
    { id: "usage", label: "Usage" },
  ];

  return (
    <section className="stage-panel" aria-label="Generated project preview">
      <div className="stage-toolbar">
        <div className="project-heading">
          <p className="project-title">
            {poc ? (
              <>
                {p.projectName} <span style={{ color: "#a2a39c", fontWeight: 400 }}>/</span> {pageTitle}
              </>
            ) : (
              "No project yet"
            )}
          </p>
          <div className="project-subtitle">
            {p.subtitle}
            {p.deployedUrl && (
              <>
                {" "}
                <span aria-hidden="true">·</span>{" "}
                <a className="project-link" href={p.deployedUrl} target="_blank" rel="noopener noreferrer">
                  Live preview ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="toolbar-actions">
          <span className="saved-state">{p.saved}</span>
          <button className="deploy-button" type="button" onClick={p.onDeploy} disabled={!poc} title={poc ? "Deploy to Vercel" : "Build a POC first"}>
            <UploadIcon />
            Deploy
          </button>
        </div>
      </div>

      <div className="view-tabs" role="tablist" aria-label="Project views">
        {tabs.map((tab) => (
          <button key={tab.id} className="tab" type="button" role="tab" id={`tab-${tab.id}`} aria-selected={p.view === tab.id} aria-controls={`panel-${tab.id}`} onClick={() => p.onViewChange(tab.id)}>
            {tab.label}
            {tab.count !== undefined && <span style={{ color: "#a1a29c" }}> {tab.count}</span>}
          </button>
        ))}
      </div>

      <div className="preview-area preview-stack">
        {!poc && p.view !== "usage" && (
          <div className="empty-stage" role="tabpanel" id={`panel-${p.view}`} aria-labelledby={`tab-${p.view}`}>
            <span className="empty-mark" aria-hidden="true">d</span>
            <strong>No prototype yet</strong>
            <span>Paste an Upwork job ID and click Fetch, or fill in the brief by hand, then press Build POC. Your clickable site will appear here.</span>
          </div>
        )}
        {poc && p.view === "preview" && (
          <div role="tabpanel" id="panel-preview" aria-labelledby="tab-preview">
            <SitePreview poc={poc} pageId={p.pageId} device={device} onNavigate={navigate} />
          </div>
        )}
        {poc && p.view === "pages" && (
          <div className="alternate-view is-visible" role="tabpanel" id="panel-pages" aria-labelledby="tab-pages">
            <p className="eyebrow">The site map</p>
            <div className="page-list">
              {poc.pages.map((page) => (
                <button key={page.id} className="page-row" type="button" onClick={() => navigate(page.id)}>
                  <span>
                    <strong>{page.title}</strong>
                    <span>{page.description}</span>
                  </span>
                  <span className="page-status">PREVIEW</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {poc && p.view === "content" && (
          <div className="alternate-view is-visible" role="tabpanel" id="panel-content" aria-labelledby="tab-content">
            <p className="eyebrow">Sample content</p>
            <div className="data-list">
              {poc.contentSummary.map((item) => (
                <div className="data-item" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
        {p.view === "usage" && <UsagePanel log={p.usageLog} onClear={p.onClearUsage} />}
        {p.building && (
          <div className="build-overlay" role="status" aria-live="polite">
            <div className="ring" aria-hidden="true" />
            <div>
              <strong>Building your prototype…</strong>
              <span>Generating pages and content with {p.buildingModel}. This usually takes under a minute.</span>
            </div>
          </div>
        )}
      </div>

      <div className="under-stage">
        <span>{hint}</span>
        <div className="device-toggle" role="group" aria-label="Preview size">
          {DEVICES.map((d) => (
            <button key={d.id} type="button" disabled={!poc} aria-pressed={device === d.id} onClick={() => setDevice(d.id)} title={`${d.label} preview`}>
              {d.icon}
              <span>{d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
