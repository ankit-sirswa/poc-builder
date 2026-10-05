import { PocSchema, type Brief, type ModelId, type Poc } from "../../shared/schema";

/** Autosaved project state. Never contains credentials. */
export interface SavedState {
  brief: Brief;
  model: ModelId;
  poc: Poc | null;
  projectName: string;
  built: { model: string; run?: number; tokens?: number } | null;
  fetcherTarget?: string;
}

const KEY = "draftwork:project:v2";
const LEGACY_KEY = "draftwork:project:v1";

/**
 * Early versions pre-filled a sample brief and sample site, and autosaved them into
 * the browser. Drop exactly those (untouched) so nobody starts on example data;
 * anything the user typed, fetched or built is kept.
 */
function withoutLegacySample(raw: any) {
  const brief = raw?.brief;
  const untouchedBrief =
    brief?.title === "Brand site for a mindful architecture studio" && String(brief?.description ?? "").startsWith("We're a small architecture studio");
  const sampleSite = raw?.poc?.site?.name === "Fieldwork Studio";
  return {
    ...raw,
    brief: untouchedBrief ? undefined : brief,
    poc: sampleSite ? undefined : raw?.poc,
    projectName: sampleSite ? undefined : raw?.projectName,
    built: sampleSite ? undefined : raw?.built,
  };
}

export function loadState(): Partial<SavedState> | null {
  try {
    let raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
      if (legacy && typeof legacy === "object") raw = withoutLegacySample(legacy);
    }
    if (!raw || typeof raw !== "object") return null;
    const poc = PocSchema.safeParse(raw.poc);
    return { ...raw, poc: poc.success ? poc.data : null };
  } catch {
    return null;
  }
}

export function saveState(state: SavedState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable: the project just isn't autosaved */
  }
}
