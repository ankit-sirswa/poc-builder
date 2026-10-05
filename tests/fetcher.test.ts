import { describe, expect, it } from "vitest";
import { mapJobToBrief } from "../server/fetcher";
import { normalizeJobId } from "../server/job-id";

describe("normalizeJobId", () => {
  it("accepts a bare id, a ~id and a job URL", () => {
    expect(normalizeJobId("02abc1234567890def")).toBe("02abc1234567890def");
    expect(normalizeJobId("~02abc1234567890def")).toBe("02abc1234567890def");
    expect(normalizeJobId("  https://www.upwork.com/jobs/Landing-site_~02abc1234567890def/?referrer=x ")).toBe("02abc1234567890def");
    expect(normalizeJobId("https://www.upwork.com/nx/search/jobs/details/~02abc1234567890def")).toBe("02abc1234567890def");
    expect(normalizeJobId("1234567890123456789")).toBe("1234567890123456789");
  });

  it("rejects junk and anything that isn't path-safe", () => {
    expect(normalizeJobId("")).toBeNull();
    expect(normalizeJobId("   ")).toBeNull();
    expect(normalizeJobId(42)).toBeNull();
    expect(normalizeJobId("../../etc/passwd")).toBeNull();
    expect(normalizeJobId("a b c")).toBeNull();
    expect(normalizeJobId("x".repeat(600))).toBeNull();
  });
});

describe("mapJobToBrief", () => {
  const job = {
    id: "02abc1234567890def",
    url: "https://www.upwork.com/jobs/~02abc1234567890def",
    title: "  Landing site for a yoga studio ",
    description: "Calm, modern site.",
    budget_type: "fixed",
    budget: "$800–$1,500",
    category: "Web, Mobile & Software Dev",
    project_type: "One-time project",
    skills: ["Figma", { name: "React" }],
    screening_questions: ["Have you built a booking form?", { question: "Share a similar site" }],
    experience_level: "Intermediate",
    duration: "1 to 3 months",
    client_name: "Zen Austin",
    client_location: "Austin, TX",
    tier: "strong",
    posted_at: "2026-10-01T10:00:00Z",
  };

  it("fills every brief field from the job", () => {
    const { brief, meta } = mapJobToBrief(job, "fallback");
    expect(brief.jobId).toBe("02abc1234567890def");
    expect(brief.title).toBe("Landing site for a yoga studio");
    expect(brief.description).toBe("Calm, modern site.");
    expect(brief.budget).toBe("$800–$1,500 (fixed)");
    expect(brief.projectType).toBe("Web, Mobile & Software Dev");
    expect(brief.requirements).toContain("Skills: Figma, React");
    expect(brief.requirements).toContain("Experience level: Intermediate");
    expect(brief.requirements).toContain("Client: Zen Austin, Austin, TX");
    expect(brief.requirements).toContain("- Have you built a booking form?");
    expect(brief.requirements).toContain("- Share a similar site");
    expect(meta).toEqual({ id: "02abc1234567890def", url: job.url, tier: "strong", postedAt: job.posted_at });
  });

  it("handles JSON-string lists and builds a budget from min/max or an hourly rate", () => {
    const a = mapJobToBrief({ ...job, budget: "", budget_min: "1500", budget_max: "3000", skills: '["A","B"]', screening_questions: "[]" }, "x");
    expect(a.brief.budget).toBe("$1,500–$3,000 (fixed)");
    expect(a.brief.requirements).toContain("Skills: A, B");
    expect(a.brief.requirements).not.toContain("Screening");
    const b = mapJobToBrief({ id: "z", title: "T", budget_type: "hourly", hourly_rate: "25-50", skills: "react, node" }, "x");
    expect(b.brief.budget).toBe("$25-50/hr");
    expect(b.brief.requirements).toContain("Skills: react, node");
  });

  it("copes with a sparse job and respects the brief's length limits", () => {
    const { brief } = mapJobToBrief({ title: "Only a title", description: "d".repeat(30000) }, "fallback-id");
    expect(brief.jobId).toBe("fallback-id");
    expect(brief.budget).toBe("");
    expect(brief.requirements).toBe("");
    expect(brief.description).toHaveLength(20000);
  });
});
