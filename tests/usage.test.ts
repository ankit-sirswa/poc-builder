import { describe, expect, it } from "vitest";
import { EMPTY_LOG, logTotals, parseUsageLog, pocKey, pocTotals, recordRun, type NewRun } from "../src/lib/usage";

const usage = (p: number, c: number) => ({ promptTokens: p, completionTokens: c, totalTokens: p + c });
const run = (over: Partial<NewRun> = {}): NewRun => ({
  key: "job:02abc", jobId: "02abc", title: "Yoga site", model: "gpt-4.1-mini", at: "2026-10-03T10:00:00.000Z", status: "ok", usage: usage(1000, 3000), ...over,
});

describe("pocKey", () => {
  it("treats a pasted URL, ~id and bare id as the same POC", () => {
    const bare = pocKey({ jobId: "02ABC1234567890def", title: "A" });
    expect(pocKey({ jobId: "~02abc1234567890def", title: "B" })).toBe(bare);
    expect(pocKey({ jobId: "https://www.upwork.com/jobs/Site_~02abc1234567890def/", title: "C" })).toBe(bare);
  });

  it("falls back to the normalized title when there is no job id", () => {
    expect(pocKey({ jobId: "  ", title: "  Brand   Site " })).toBe("title:brand site");
    expect(pocKey({ jobId: "", title: "Brand site" })).toBe(pocKey({ jobId: "", title: "BRAND SITE" }));
    expect(pocKey({ jobId: "", title: "x" })).not.toBe(pocKey({ jobId: "02abc", title: "x" }));
  });
});

describe("recordRun", () => {
  it("first run of a POC is a build; later runs of the same POC are reruns", () => {
    const a = recordRun(EMPTY_LOG, run());
    expect(a.kind).toBe("build");
    expect(a.runNumber).toBe(1);
    const b = recordRun(a.log, run({ at: "2026-10-03T10:05:00.000Z", usage: usage(1100, 2900) }));
    expect(b.kind).toBe("rerun");
    expect(b.runNumber).toBe(2);
    expect(b.log.pocs).toHaveLength(1);
    expect(b.log.pocs[0].runs.map((r) => r.kind)).toEqual(["build", "rerun"]);
    expect(b.log.pocs[0].createdAt).toBe("2026-10-03T10:00:00.000Z");
  });

  it("a different job is a new POC, and the most recently used POC comes first", () => {
    let log = recordRun(EMPTY_LOG, run()).log;
    log = recordRun(log, run({ key: "job:02other", jobId: "02other", title: "Coffee shop" })).log;
    expect(log.pocs.map((p) => p.title)).toEqual(["Coffee shop", "Yoga site"]);
    const again = recordRun(log, run());
    expect(again.kind).toBe("rerun");
    expect(again.log.pocs.map((p) => p.title)).toEqual(["Yoga site", "Coffee shop"]);
  });

  it("keeps the latest title and does not mutate the previous log", () => {
    const first = recordRun(EMPTY_LOG, run());
    const snapshot = JSON.stringify(first.log);
    const second = recordRun(first.log, run({ title: "Yoga site v2" }));
    expect(second.log.pocs[0].title).toBe("Yoga site v2");
    expect(JSON.stringify(first.log)).toBe(snapshot);
  });

  it("records a failed run that was billed, and a run with no usage info", () => {
    let log = recordRun(EMPTY_LOG, run()).log;
    log = recordRun(log, run({ status: "failed", usage: usage(1000, 50) })).log;
    log = recordRun(log, run({ usage: null })).log;
    const runs = log.pocs[0].runs;
    expect(runs.map((r) => r.status)).toEqual(["ok", "failed", "ok"]);
    expect(pocTotals(log.pocs[0])).toEqual({ runs: 3, prompt: 2000, completion: 3050, total: 5050 });
  });

  it("caps history so storage can't grow without bound", () => {
    let log = EMPTY_LOG;
    for (let i = 0; i < 230; i++) log = recordRun(log, run({ key: `job:${i}`, jobId: String(i), title: `T${i}` })).log;
    expect(log.pocs).toHaveLength(200);
    expect(log.pocs[0].title).toBe("T229");
    let many = EMPTY_LOG;
    for (let i = 0; i < 230; i++) many = recordRun(many, run()).log;
    expect(many.pocs[0].runs).toHaveLength(200);
  });
});

describe("totals", () => {
  it("adds up POCs, builds, reruns and tokens", () => {
    let log = recordRun(EMPTY_LOG, run()).log;
    log = recordRun(log, run({ usage: usage(500, 1500) })).log;
    log = recordRun(log, run({ key: "job:02other", jobId: "02other", title: "Other", usage: usage(200, 800) })).log;
    expect(logTotals(log)).toEqual({ pocs: 2, runs: 3, reruns: 1, prompt: 1700, completion: 5300, total: 7000 });
    expect(logTotals(EMPTY_LOG)).toEqual({ pocs: 0, runs: 0, reruns: 0, prompt: 0, completion: 0, total: 0 });
  });
});

describe("parseUsageLog", () => {
  it("round-trips a valid log", () => {
    const log = recordRun(recordRun(EMPTY_LOG, run()).log, run()).log;
    expect(parseUsageLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it("survives junk, drops malformed entries and clamps bad numbers", () => {
    expect(parseUsageLog(null)).toEqual(EMPTY_LOG);
    expect(parseUsageLog("nope")).toEqual(EMPTY_LOG);
    expect(parseUsageLog({ pocs: "x" })).toEqual(EMPTY_LOG);
    const parsed = parseUsageLog({
      pocs: [
        { nope: true },
        { key: "job:1", title: 5, runs: [null, { kind: "weird", status: "weird", usage: { promptTokens: -5, completionTokens: "9", totalTokens: 12.7 } }] },
      ],
    });
    expect(parsed.pocs).toHaveLength(1);
    expect(parsed.pocs[0].title).toBe("Untitled");
    expect(parsed.pocs[0].runs).toHaveLength(1);
    expect(parsed.pocs[0].runs[0]).toMatchObject({ kind: "build", status: "ok", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 12 } });
  });
});
