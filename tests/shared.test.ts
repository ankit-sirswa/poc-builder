import { describe, expect, it } from "vitest";
import { renderPage, renderSiteFiles } from "../shared/render";
import { PocSchema, normalizePoc, slugify } from "../shared/schema";
import { SAMPLE_POC } from "./fixtures/sample";

const clone = () => structuredClone(SAMPLE_POC);

describe("sample POC", () => {
  it("matches the schema and keeps the prototype's four pages", () => {
    expect(PocSchema.safeParse(SAMPLE_POC).success).toBe(true);
    expect(SAMPLE_POC.pages.map((p) => p.title)).toEqual(["Home", "Projects", "Studio", "Contact"]);
    expect(SAMPLE_POC.contentSummary).toHaveLength(6);
  });
});

describe("normalizePoc", () => {
  it("forces the first page to home, dedupes ids and repairs links and colours", () => {
    const poc = clone();
    poc.pages[0].id = "landing";
    poc.pages[1].id = "Our Work!";
    poc.pages[2].id = "our-work";
    poc.site.ctaPage = "Contact";
    poc.site.accentColor = "red";
    const out = normalizePoc(poc);
    const ids = out.pages.map((p) => p.id);
    expect(ids[0]).toBe("home");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("our-work");
    expect(out.site.ctaPage).toBe("contact");
    expect(out.site.accentColor).toBe("#e66d45");
  });

  it("points dangling links at an existing page", () => {
    const poc = clone();
    const hero = poc.pages[0].sections[0];
    if (hero.type !== "hero") throw new Error("expected hero");
    hero.ctaPage = "does-not-exist";
    const out = normalizePoc(poc);
    const fixed = out.pages[0].sections[0];
    expect(out.pages.some((p) => fixed.type === "hero" && p.id === fixed.ctaPage)).toBe(true);
  });

  it("drops empty pages and rejects a site with none", () => {
    const poc = clone();
    poc.pages.forEach((p) => (p.sections = []));
    expect(() => normalizePoc(poc)).toThrow();
  });
});

describe("renderer", () => {
  it("escapes model text and rejects non-http image URLs", () => {
    const poc = clone();
    poc.site.name = '<script>alert(1)</script>"';
    const hero = poc.pages[0].sections[0];
    if (hero.type !== "hero") throw new Error("expected hero");
    hero.heading = "<img src=x onerror=alert(1)>";
    hero.image.url = "javascript:alert(1)";
    const html = renderPage(poc, "home", "deploy");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("picsum.photos/seed/warm-home-interior/");
  });

  it("preview mode links by hash and posts navigation; deploy mode uses real paths", () => {
    const preview = renderPage(SAMPLE_POC, "home", "preview");
    const deploy = renderPage(SAMPLE_POC, "home", "deploy");
    expect(preview).toContain('href="#projects"');
    expect(preview).toContain("poc-preview");
    expect(deploy).toContain('href="/projects/"');
    expect(deploy).not.toContain("poc-preview");
  });

  it("marks the current page and produces one file per page", () => {
    expect(renderPage(SAMPLE_POC, "studio", "deploy")).toMatch(/data-page="studio" aria-current="page"/);
    expect(renderSiteFiles(SAMPLE_POC).map((f) => f.file)).toEqual(["index.html", "projects/index.html", "studio/index.html", "contact/index.html"]);
  });

  it("renders every sample page with its prototype content", () => {
    expect(renderPage(SAMPLE_POC, "home", "deploy")).toContain("Make room for a more thoughtful life.");
    expect(renderPage(SAMPLE_POC, "projects", "deploy")).toContain("Cedar Ridge");
    expect(renderPage(SAMPLE_POC, "studio", "deploy")).toContain("Maya Chen and Eli Navarro");
    const contact = renderPage(SAMPLE_POC, "contact", "deploy");
    expect(contact).toContain("2131 SE Division St<br>Portland, Oregon");
    expect(contact).toContain("data-sample-form");
  });
});

describe("slugify", () => {
  it("makes safe slugs", () => {
    expect(slugify("  Café & Bar!! ")).toBe("cafe-bar");
    expect(slugify("***", "x")).toBe("x");
  });
});
