import { useEffect, useMemo, useRef, useState } from "react";
import { renderPage, siteHost } from "../../shared/render";
import type { Poc } from "../../shared/schema";

export type Device = "desktop" | "tablet" | "mobile";
export const DEVICE_WIDTH: Record<Device, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };

interface Props {
  poc: Poc;
  pageId: string;
  device: Device;
  onNavigate: (pageId: string) => void;
}

/** The generated site in a sandboxed iframe — the same HTML that gets deployed. */
export function SitePreview({ poc, pageId, device, onNavigate }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(389);
  const html = useMemo(() => renderPage(poc, pageId, "preview"), [poc, pageId]);
  const pageIds = useMemo(() => new Set(poc.pages.map((p) => p.id)), [poc]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "poc-preview") return;
      if (data.type === "navigate" && typeof data.page === "string" && pageIds.has(data.page)) onNavigate(data.page);
      if (data.type === "height" && Number.isFinite(data.height)) setHeight(Math.max(389, Math.min(20000, data.height)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onNavigate, pageIds]);

  const title = poc.pages.find((p) => p.id === pageId)?.title ?? "Home";
  return (
    <div className="frame-viewport" style={{ width: DEVICE_WIDTH[device] }}>
      <div className="browser-frame">
        <div className="browser-bar">
          <div className="traffic-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="address">
            {siteHost(poc)}
            {pageId === "home" ? "" : `/${pageId}`}
          </div>
          <div className="browser-side" aria-hidden="true">
            ↗
          </div>
        </div>
        <iframe ref={frame} title={`${poc.site.name} — ${title} page preview`} srcDoc={html} sandbox="allow-scripts allow-forms" style={{ height }} />
      </div>
    </div>
  );
}
