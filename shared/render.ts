import { slugify, type Poc, type PocPage, type Section, type SectionImage } from "./schema";

/**
 * Renders a POC to static HTML. The in-app preview (an iframe) and the Vercel
 * deployment use this same code, so what you review is what ships.
 * All model-written text is escaped; only http(s) image URLs are allowed.
 */

export type RenderMode = "preview" | "deploy";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: string) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
const multiline = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");

const isHttpUrl = (value: string | null | undefined): value is string => !!value && /^https?:\/\//i.test(value);

function imageSrc(image: SectionImage, width: number, height: number) {
  if (isHttpUrl(image.url)) return image.url;
  return `https://picsum.photos/seed/${encodeURIComponent(slugify(image.seed, "photo"))}/${width}/${height}`;
}

export const siteHost = (poc: Poc) => `${slugify(poc.site.name, "site")}.preview.site`;
export const pagePath = (pageId: string) => (pageId === "home" ? "/" : `/${pageId}/`);

interface Ctx {
  poc: Poc;
  mode: RenderMode;
}

function link(ctx: Ctx, pageId: string) {
  return ctx.mode === "preview" ? `#${escapeHtml(pageId)}` : pagePath(pageId);
}

const eyebrow = (text: string) => (text ? `<p class="eyebrow">${escapeHtml(text)}</p>` : "");

function renderSection(section: Section, ctx: Ctx): string {
  switch (section.type) {
    case "hero":
      return `<section class="hero wrap"><div>${eyebrow(section.eyebrow)}<h1>${escapeHtml(section.heading)}</h1><p class="lead">${escapeHtml(section.body)}</p><a class="button" href="${link(ctx, section.ctaPage)}" data-page="${escapeHtml(section.ctaPage)}">${escapeHtml(section.ctaLabel)} <span>↗</span></a></div><div class="artwork"><img src="${escapeHtml(imageSrc(section.image, 900, 880))}" alt="${escapeHtml(section.image.alt)}"><span class="sun"></span><span class="caption">${escapeHtml(section.caption)}</span></div></section>`;
    case "cards":
      return `<section class="wrap block">${eyebrow(section.eyebrow)}<h2>${escapeHtml(section.heading)}</h2><p class="copy">${escapeHtml(section.body)}</p><div class="cards">${section.items
        .map(
          (item) =>
            `<article class="card"><img src="${escapeHtml(imageSrc(item.image, 600, 470))}" alt="${escapeHtml(item.image.alt)}"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.meta)}</span></div></article>`,
        )
        .join("")}</div></section>`;
    case "about":
      return `<section class="wrap block about${section.stats.length ? "" : " solo"}"><div>${eyebrow(section.eyebrow)}<h2>${escapeHtml(section.heading)}</h2>${section.paragraphs
        .map((p) => `<p class="copy">${escapeHtml(p)}</p>`)
        .join("")}</div>${
        section.stats.length
          ? `<div class="facts">${section.stats.map((s) => `<div class="fact"><strong>${escapeHtml(s.value)}</strong><span>${escapeHtml(s.label)}</span></div>`).join("")}</div>`
          : ""
      }</section>`;
    case "features":
      return `<section class="wrap block">${eyebrow(section.eyebrow)}<h2>${escapeHtml(section.heading)}</h2><div class="features">${section.items
        .map(
          (item, i) =>
            `<div class="feature"><span class="index">${String(i + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></div>`,
        )
        .join("")}</div></section>`;
    case "cta":
      return `<section class="wrap block"><div class="band"><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p><a class="button light" href="${link(ctx, section.ctaPage)}" data-page="${escapeHtml(section.ctaPage)}">${escapeHtml(section.ctaLabel)} <span>↗</span></a></div></section>`;
    case "contact":
      return `<section class="wrap block contact"><div>${eyebrow(section.eyebrow)}<h2>${escapeHtml(section.heading)}</h2><p class="copy">${escapeHtml(section.body)}</p><form class="form" data-sample-form><input aria-label="Your name" placeholder="Your name" required><input aria-label="Email address" type="email" placeholder="Email address" required><textarea aria-label="Project notes" placeholder="A few words about your project" required></textarea><button type="submit">${escapeHtml(section.submitLabel)}</button><p class="form-note" role="status" hidden>Sample inquiry received. No message was sent.</p></form></div><div class="details">${section.details
        .map((d) => `<span>${escapeHtml(d.label)}</span><strong>${multiline(d.value)}</strong>`)
        .join("")}</div></section>`;
  }
}

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;color:#4d5249;background:#f9f8f2;font:16px/1.6 "Avenir Next",Avenir,"Segoe UI",system-ui,sans-serif}
img{display:block;max-width:100%}
a{color:inherit}
.wrap{width:min(1080px,100% - 12%);margin:0 auto}
.nav{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;padding:14px 6%;border-bottom:1px solid #e6e4dc}
.brand{color:var(--ink);font:700 24px/1 "Iowan Old Style",Baskerville,"Palatino Linotype",Georgia,serif;text-decoration:none}
.brand span{color:var(--accent)}
.links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 26px;font-size:14px}
.links a{color:#6a6f66;text-decoration:none;padding:4px 0}
.links a:hover,.links a[aria-current="page"]{color:var(--accent)}
.links a.cta{padding:8px 14px;border:1px solid #abb4a6;border-radius:3px;color:var(--ink)}
.links a.cta:hover{color:var(--accent);border-color:var(--accent)}
h1,h2{margin:0;color:var(--ink);font:500 clamp(34px,5vw,56px)/1.04 "Iowan Old Style",Baskerville,"Palatino Linotype",Georgia,serif}
h2{font-size:clamp(28px,4vw,42px);line-height:1.08;max-width:640px}
.eyebrow{display:flex;align-items:center;gap:9px;margin:0 0 16px;color:#7b8b72;font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.9px;text-transform:uppercase}
.eyebrow::before{width:18px;height:1px;background:var(--accent);content:""}
.lead{max-width:430px;margin:18px 0 0;font-size:17px}
.copy{max-width:560px;margin:14px 0 0}
.button{display:inline-flex;align-items:center;gap:12px;margin-top:28px;padding:13px 18px;border-radius:3px;color:#fff;background:var(--ink);font-size:14px;text-decoration:none}
.button span{color:#d4a17e;font-size:17px}
.button:hover{filter:brightness(1.12)}
.hero{display:grid;grid-template-columns:1fr .78fr;gap:6%;align-items:center;padding:56px 0 64px}
.artwork{position:relative;aspect-ratio:1.02;overflow:hidden;border-radius:48% 48% 3px 3px;background:#e8e8d8}
.artwork img{position:absolute;z-index:0;inset:0;width:100%;height:100%;object-fit:cover}
.artwork::before{position:absolute;right:-9%;bottom:-24%;left:-5%;height:71%;border:1px solid #73836b;border-radius:50% 50% 0 0;background:repeating-linear-gradient(0deg,transparent 0 16px,#85927b 17px,transparent 18px);content:"";transform:rotate(-12deg)}
.artwork::after{position:absolute;top:5%;left:17%;width:63%;height:91%;border:1px solid #99a18a;border-radius:50%;background:repeating-linear-gradient(90deg,transparent 0 21px,#9fa692 22px,transparent 23px);content:"";transform:rotate(22deg)}
.sun{position:absolute;top:15%;right:15%;width:24%;aspect-ratio:1;border-radius:50%;background:#db8d67}
.caption{position:absolute;z-index:1;right:12px;bottom:14px;padding:6px 9px;color:#4f5d4a;background:#f9f8f2dc;font:10px ui-monospace,SFMono-Regular,Consolas,monospace}
.block{padding:56px 0 24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding-top:36px}
.card{overflow:hidden;border:1px solid #e5e4db;border-radius:3px;background:#fffefa}
.card img{width:100%;aspect-ratio:1.28;object-fit:cover;background:#e8e8d8}
.card div{padding:14px}
.card strong,.card span{display:block}
.card strong{color:var(--ink);font:600 19px/1.3 "Iowan Old Style",Baskerville,Georgia,serif}
.card span{margin-top:4px;color:#7c8076;font-size:13px}
.about{display:grid;grid-template-columns:1fr .7fr;gap:7%;align-items:center;padding-bottom:48px}
.about.solo{grid-template-columns:1fr}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.fact{padding:18px;border:1px solid #e1e3d8;background:#f0f0e6}
.fact strong{display:block;color:var(--ink);font:500 30px/1.2 "Iowan Old Style",Baskerville,Georgia,serif}
.fact span{color:#6e7368;font-size:13px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;padding-top:32px}
.feature{padding:20px;border:1px solid #e1e3d8;background:#f4f4ea}
.feature .index{display:block;margin-bottom:12px;color:var(--accent);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
.feature strong{color:var(--ink);font:600 19px/1.3 "Iowan Old Style",Baskerville,Georgia,serif}
.feature p{margin:8px 0 0;font-size:15px}
.band{padding:44px 6%;border-radius:4px;color:#e9ece4;background:var(--ink)}
.band h2{color:#fff;max-width:560px}
.band p{max-width:520px;margin:14px 0 0}
.button.light{color:var(--ink);background:#f9f8f2}
.contact{display:grid;grid-template-columns:1fr .85fr;gap:8%;padding-bottom:56px}
.form{display:grid;gap:10px;margin-top:24px}
.form input,.form textarea{width:100%;padding:12px;border:1px solid #e2e2d9;border-radius:2px;color:var(--ink);background:#fffefa;font:inherit;font-size:15px}
.form textarea{min-height:110px;resize:vertical}
.form button{justify-self:start;padding:12px 16px;border:0;border-radius:2px;color:#fff;background:var(--ink);cursor:pointer;font:inherit;font-size:14px}
.form-note{margin:0;color:#496044;font-size:14px}
.details{align-self:start;padding:24px;background:#eff0e7}
.details span,.details strong{display:block}
.details span{margin:0 0 6px;color:#767b70;font:11px ui-monospace,SFMono-Regular,Consolas,monospace;text-transform:uppercase}
.details strong{margin-bottom:20px;color:var(--ink);font:500 19px/1.35 "Iowan Old Style",Baskerville,Georgia,serif}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;margin-top:40px;padding:16px 6%;border-top:1px solid #e6e4dc;color:#82867b;font:11px ui-monospace,SFMono-Regular,Consolas,monospace}
@media (max-width:720px){
.hero,.about,.contact{grid-template-columns:1fr}
.hero{padding:36px 0 44px;gap:32px}
.artwork{aspect-ratio:1.1}
.links{gap:4px 18px}
}`;

const PREVIEW_SCRIPT = `
document.addEventListener("click",function(e){var a=e.target.closest("[data-page]");if(!a)return;e.preventDefault();parent.postMessage({source:"poc-preview",type:"navigate",page:a.getAttribute("data-page")},"*")});
function report(){parent.postMessage({source:"poc-preview",type:"height",height:Math.ceil(document.body.getBoundingClientRect().height)},"*")}
new ResizeObserver(report).observe(document.body);window.addEventListener("load",report);`;

const FORM_SCRIPT = `
document.querySelectorAll("[data-sample-form]").forEach(function(f){f.addEventListener("submit",function(e){e.preventDefault();f.reset();var n=f.querySelector(".form-note");if(n)n.hidden=false})});`;

export function renderPage(poc: Poc, pageId: string, mode: RenderMode): string {
  const page: PocPage = poc.pages.find((p) => p.id === pageId) ?? poc.pages[0];
  const ctx: Ctx = { poc, mode };
  const { site } = poc;

  const nav = poc.pages
    .filter((p) => p.id !== "home" && p.id !== site.ctaPage)
    .map(
      (p) =>
        `<a href="${link(ctx, p.id)}" data-page="${escapeHtml(p.id)}"${p.id === page.id ? ' aria-current="page"' : ""}>${escapeHtml(p.title)}</a>`,
    )
    .join("");
  const cta = `<a class="cta" href="${link(ctx, site.ctaPage)}" data-page="${escapeHtml(site.ctaPage)}"${site.ctaPage === page.id ? ' aria-current="page"' : ""}>${escapeHtml(site.ctaLabel)}</a>`;
  const description = page.description || `${site.name} — sample website`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.id === "home" ? site.name : `${page.title} — ${site.name}`)}</title>
<meta name="description" content="${escapeHtml(description)}">
<style>:root{--ink:${site.inkColor};--accent:${site.accentColor}}${CSS}</style>
</head>
<body>
<nav class="nav" aria-label="${escapeHtml(site.name)}"><a class="brand" href="${link(ctx, "home")}" data-page="home" aria-label="${escapeHtml(site.name)} home">${escapeHtml(site.wordmark)}<span>.</span></a><div class="links">${nav}${cta}</div></nav>
<main>${page.sections.map((s) => renderSection(s, ctx)).join("")}</main>
<footer class="foot"><span>${escapeHtml(site.footerLeft)}</span><span>${escapeHtml(site.footerRight)}</span></footer>
<script>${FORM_SCRIPT}${mode === "preview" ? PREVIEW_SCRIPT : ""}</script>
</body>
</html>`;
}

/** Files for a Vercel static deployment: `/` plus one `<page>/index.html` per page. */
export function renderSiteFiles(poc: Poc): { file: string; data: string }[] {
  return poc.pages.map((page) => ({
    file: page.id === "home" ? "index.html" : `${page.id}/index.html`,
    data: renderPage(poc, page.id, "deploy"),
  }));
}
