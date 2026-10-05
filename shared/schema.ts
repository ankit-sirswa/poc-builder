import { z } from "zod";

/**
 * The POC document: everything needed to render a clickable multi-page site.
 * It is the contract between OpenAI generation, the in-app preview and the
 * Vercel deploy. OpenAI strict structured outputs require every key to be
 * present, so optional values are `nullable`, not `optional`.
 */

const Image = z.object({
  /** Seed for a deterministic placeholder photo (e.g. "oak-house-living-room"). */
  seed: z.string(),
  alt: z.string(),
  /** Explicit image URL. Generated output leaves this null. */
  url: z.string().nullable(),
});

const Hero = z.object({
  type: z.literal("hero"),
  eyebrow: z.string(),
  heading: z.string(),
  body: z.string(),
  ctaLabel: z.string(),
  /** Page id the button links to. */
  ctaPage: z.string(),
  image: Image,
  caption: z.string(),
});

const Cards = z.object({
  type: z.literal("cards"),
  eyebrow: z.string(),
  heading: z.string(),
  body: z.string(),
  items: z.array(z.object({ title: z.string(), meta: z.string(), image: Image })),
});

const About = z.object({
  type: z.literal("about"),
  eyebrow: z.string(),
  heading: z.string(),
  paragraphs: z.array(z.string()),
  stats: z.array(z.object({ value: z.string(), label: z.string() })),
});

const Features = z.object({
  type: z.literal("features"),
  eyebrow: z.string(),
  heading: z.string(),
  items: z.array(z.object({ title: z.string(), body: z.string() })),
});

const Cta = z.object({
  type: z.literal("cta"),
  heading: z.string(),
  body: z.string(),
  ctaLabel: z.string(),
  ctaPage: z.string(),
});

const Contact = z.object({
  type: z.literal("contact"),
  eyebrow: z.string(),
  heading: z.string(),
  body: z.string(),
  submitLabel: z.string(),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
});

export const SectionSchema = z.discriminatedUnion("type", [Hero, Cards, About, Features, Cta, Contact]);

const Page = z.object({
  /** URL slug: lowercase letters, digits and dashes. The first page is the home page. */
  id: z.string(),
  /** Navigation label. */
  title: z.string(),
  /** One line describing the page, shown in the Pages tab. */
  description: z.string(),
  sections: z.array(SectionSchema),
});

export const PocSchema = z.object({
  site: z.object({
    name: z.string(),
    /** Short lowercase wordmark for the nav bar. */
    wordmark: z.string(),
    location: z.string(),
    footerLeft: z.string(),
    footerRight: z.string(),
    /** Label of the highlighted nav button. */
    ctaLabel: z.string(),
    /** Page id the nav button links to. */
    ctaPage: z.string(),
    /** Hex colours, e.g. "#e66d45". */
    accentColor: z.string(),
    inkColor: z.string(),
  }),
  pages: z.array(Page),
  /** Key facts shown in the Content tab. */
  contentSummary: z.array(z.object({ label: z.string(), value: z.string() })),
});

export type Poc = z.infer<typeof PocSchema>;
export type PocPage = z.infer<typeof Page>;
export type Section = z.infer<typeof SectionSchema>;
export type SectionImage = z.infer<typeof Image>;

export const BriefSchema = z.object({
  jobId: z.string().max(512),
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(20000),
  budget: z.string().max(120),
  projectType: z.string().max(120),
  requirements: z.string().max(5000),
});
export type Brief = z.infer<typeof BriefSchema>;

export const MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini · quicker, lower cost" },
  { id: "gpt-4.1", label: "GPT-4.1 · detailed project briefs" },
  { id: "gpt-4o", label: "GPT-4o · multimodal generation" },
  { id: "gpt-4o-mini", label: "GPT-4o mini · lightweight" },
] as const;
export type ModelId = string;

/** Tokens OpenAI billed for one generation call. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const slugify = (value: string, fallback = "page") =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || fallback;

/**
 * Model output is untrusted. Guarantees what the renderer relies on: a home
 * page exists, page ids are unique slugs, link targets resolve, colours are
 * valid hex and every page has content.
 */
export function normalizePoc(input: Poc): Poc {
  const seen = new Set<string>();
  const pages = input.pages
    .filter((page) => page.sections.length > 0)
    .slice(0, 8)
    .map((page, index) => {
      let id = index === 0 ? "home" : slugify(page.id || page.title);
      if (id === "home" && index !== 0) id = "home-2";
      while (seen.has(id)) id = `${id}-${index}`;
      seen.add(id);
      return { ...page, id, title: page.title.trim() || id };
    });
  if (pages.length === 0) throw new Error("The generated site has no pages.");

  const resolve = (target: string) => {
    const wanted = slugify(target, "");
    return pages.find((p) => p.id === wanted || slugify(p.title) === wanted)?.id ?? pages[pages.length - 1].id;
  };
  const fixLinks = (section: Section): Section =>
    section.type === "hero" || section.type === "cta" ? { ...section, ctaPage: resolve(section.ctaPage) } : section;

  return {
    ...input,
    site: {
      ...input.site,
      ctaPage: resolve(input.site.ctaPage),
      accentColor: HEX.test(input.site.accentColor) ? input.site.accentColor : "#e66d45",
      inkColor: HEX.test(input.site.inkColor) ? input.site.inkColor : "#374838",
    },
    pages: pages.map((page) => ({ ...page, sections: page.sections.map(fixLinks) })),
    contentSummary: input.contentSummary.slice(0, 8),
  };
}
