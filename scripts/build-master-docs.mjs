#!/usr/bin/env node
// Builds the Form & Frame Master Book (PDF) and the Live Master (static HTML) from docs/master/*.md.
// Node 24, no npm packages, no network. The PDF step needs a local Chrome/Chromium (CHROME_BIN overrides the search)
// and, for page numbers in the contents, poppler-utils (pdftotext). Without them the Live Master is still built.
// Usage: node scripts/build-master-docs.mjs [--no-pdf] [--out <dir for the PDF, default dist/master>]
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeConverter } from "./master-docs/markdown.mjs";
import { baseCss, liveCss, liveJs, printCss } from "./master-docs/theme.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs/master");
const args = process.argv.slice(2);
const noPdf = args.includes("--no-pdf");
const outDir = resolve(root, args.includes("--out") ? args[args.indexOf("--out") + 1] : "dist/master");
const liveDir = join(docs, "live");

const readme = readFileSync(join(docs, "README.md"), "utf8");
const VERSION = (readme.match(/Version (\d+\.\d+\.\d+)/) || [])[1] || "0.0.0";
const SHA = (readme.match(/`([0-9a-f]{40})`/) || [])[1];
if (!SHA) throw new Error("README must state the 40-character commit SHA analysed.");
const BUILT = "18 October 2026";

// [file, chapter id, menu title]
const chapters = [
  ["README.md", "introduction", "Introduction"],
  ["design-system.md", "design-system", null],
  ["architecture.md", "architecture", null],
  ["website.md", "website", null],
  ["owner-dashboard.md", "owner-dashboard", null],
  ["backend.md", "backend", null],
  ["database.md", "database", null],
  ["integrations.md", "integrations", null],
  ["journeys.md", "journeys", null],
  ["feature-matrix.md", "feature-matrix", null],
  ["security.md", "security", null],
  ["testing.md", "testing", null],
  ["roadmap.md", "roadmap", null],
  ["pending-confirmation.md", "pending-confirmation", null],
  ["coverage.md", "coverage", null],
  ["EVIDENCE_INVENTORY.md", "evidence-inventory", null],
  ["changelog.md", "changelog", null],
];
const fileToChapter = f => (chapters.find(c => c[0] === f) || [])[1];

// 1. Evidence inventory is regenerated first; it fails the build if a cited file or pattern moved.
execFileSync(process.execPath, [join(root, "scripts/master-docs/verify-evidence.mjs")], { cwd: root, stdio: "inherit" });

// 2. Markdown to HTML
const ids = new Set(["top"]);
const conv = makeConverter({ chapterOfFile: fileToChapter, ids });
const rendered = [];
chapters.forEach(([file, id], n) => {
  let src = readFileSync(join(docs, file), "utf8");
  if (id === "introduction") src = src.replace(/^# .*\n/, "# Introduction\n");
  const first = src.match(/^# (.+)$/m)[1].replace(/`/g, "");
  const r = conv.convert(src, { chapterId: id, title: first, evidence: id === "evidence-inventory" });
  rendered.push({ id, title: first, html: r.html, blocks: r.blocks, n: n + 1 });
});

// 3. Internal link check (the build fails on a dead internal link)
const dead = [...new Set(conv.links.filter(l => !ids.has(l)))];
if (dead.length) { console.error("Dead internal links:", dead.join(", ")); process.exit(1); }
console.log(`Internal links checked: ${new Set(conv.links).size} distinct targets, 0 dead.`);

// 4. Image references must exist
const imgRefs = [...new Set(rendered.flatMap(r => [...r.html.matchAll(/src="(assets\/[^"]+)"/g)].map(m => m[1])))];
const missingImg = imgRefs.filter(p => !existsSync(join(docs, p)));
if (missingImg.length) { console.error("Missing images:", missingImg.join(", ")); process.exit(1); }
console.log(`Images referenced: ${imgRefs.length}, 0 missing.`);

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const titleOf = c => c.title;
const tocByChapter = id => conv.toc.filter(t => t.chapter === id && t.level === 2);

// ---------- Live Master ----------
function buildLive() {
  rmSync(liveDir, { recursive: true, force: true });
  mkdirSync(liveDir, { recursive: true });
  cpSync(join(docs, "assets/screenshots"), join(liveDir, "assets/screenshots"), { recursive: true });
  cpSync(join(docs, "assets/diagrams"), join(liveDir, "assets/diagrams"), { recursive: true });
  const nav = rendered.map(c => `<div><a class="ch" href="#${c.id}" data-ch="${c.id}">${esc(titleOf(c))}</a>${tocByChapter(c.id).map(h => `<a class="sub" href="#${h.id}">${esc(h.text)}</a>`).join("")}</div>`).join("");
  const index = rendered.flatMap(c => c.blocks.map(b => ({ hid: b.hid, h: b.h, t: b.t.replace(/[`*]|\\\|/g, "") })));
  const bodyFixed = rendered.map(c => `<section class="chapter" data-chapter="${c.id}">${c.html}</section>`).join("\n");
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Form &amp; Frame Live Master v${VERSION}</title>
<style>${baseCss}${liveCss}</style></head><body>
<div id="top"><button id="menu" aria-label="Menu">&#9776;</button><b>Form &amp; Frame Live Master</b></div>
<aside id="side"><h1>Form &amp; Frame<br>Live Master</h1><div class="ver">v${VERSION} · commit ${SHA.slice(0, 7)} · INTERNAL</div>
<input id="q" type="search" placeholder="Search the book (press /)" aria-label="Search" autocomplete="off"><div id="results"></div><nav id="nav">${nav}</nav></aside>
<main><div class="cover"><span class="tag">INTERNAL · NOT HOSTED PUBLICLY</span><h1>Form &amp; Frame Live Master</h1>
<p>The evidence-based description of the platform. Version ${VERSION}, ${BUILT}. Analysed commit <code style="background:rgba(255,255,255,.14);color:#fff">${SHA}</code>.</p>
<p>This site contains security findings and product decisions. Host it only behind authentication (see Introduction, “Hosting the Live Master”). It makes no network requests.</p></div>
${bodyFixed}</main>
<div id="lb"><div class="bar"><button class="out" aria-label="Zoom out">−</button><button class="fit">Fit</button><button class="in" aria-label="Zoom in">+</button><button class="x" aria-label="Close">✕</button></div><img alt=""><div class="cap"></div></div>
<script type="application/json" id="sidx">${JSON.stringify(index).replace(/</g, "\\u003c")}</script>
<script>${liveJs}</script>
</body></html>`;
  writeFileSync(join(liveDir, "index.html"), html);
  writeFileSync(join(liveDir, "HOSTING.txt"), `FORM_AND_FRAME_LIVE_MASTER v${VERSION}
Commit analysed: ${SHA}

This folder is a static site: open index.html, or serve the folder with any static file server.
It makes no network requests and sets a restrictive Content-Security-Policy and noindex robots meta.

IT IS NOT HOSTED ANYWHERE. It contains internal architecture, security findings and product decisions.
Do not publish it on an open URL and never copy it into the public site's build (dist/public).

Hosting it for the team (choose one, all configured outside this repository):
 - A separate Vercel project with Deployment Protection (Vercel Authentication or password) enabled.
 - Cloudflare Access, or any SSO-protected internal static host.
 - HTTP basic authentication on an internal web server.
Test, after deploying, that the URL returns a login page when you are signed out.
`);
  let bytes = 0; const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => { const p = join(d, e.name); e.isDirectory() ? walk(p) : (bytes += statSync(p).size); }); walk(liveDir);
  console.log(`Live Master built: ${liveDir} (${(bytes / 1e6).toFixed(1)} MB, search blocks ${index.length}).`);
}

// ---------- PDF ----------
function findChrome() {
  const c = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  return c.find(p => existsSync(p));
}
function printPdf(chrome, htmlPath, pdfPath) {
  const profile = join(outDir, "chrome-profile");
  const r = spawnSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`, "--no-pdf-header-footer", "--virtual-time-budget=20000", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], { encoding: "utf8", timeout: 240000 });
  if (r.status !== 0 || !existsSync(pdfPath)) throw new Error("Chrome PDF print failed: " + (r.stderr || "").slice(-400));
}
const pageTexts = pdf => {
  const n = Number((execFileSync("pdfinfo", [pdf]).toString().match(/Pages:\s+(\d+)/) || [])[1]);
  const t = []; for (let p = 1; p <= n; p++) t.push(execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", pdf, "-"]).toString().replace(/\s+/g, " "));
  return t;
};

const rawPageLines = pdf => {
  const n = Number((execFileSync("pdfinfo", [pdf]).toString().match(/Pages:\s+(\d+)/) || [])[1]);
  const t = []; for (let p = 1; p <= n; p++) t.push(execFileSync("pdftotext", ["-f", String(p), "-l", String(p), "-layout", pdf, "-"]).toString().split("\n"));
  return t;
};

let pdfShots = null; // set when JPEG copies of the screenshots were made for the PDF only
function bookHtml(pages) {
  const tocRows = [];
  rendered.forEach(c => {
    tocRows.push(`<div class="c r"><a href="#${c.id}">${esc(titleOf(c))}</a><i></i><span>${pages?.[c.id] ?? "00"}</span></div>`);
    tocByChapter(c.id).forEach(h => tocRows.push(`<div class="s r"><a href="#${h.id}">${esc(h.text)}</a><i></i><span>${pages?.[h.id] ?? "00"}</span></div>`));
  });
  const figs = [...rendered.flatMap(c => [...c.html.matchAll(/<figure class="fig diagram"><img[^>]*alt="([^"]*)"/g)].map(m => ({ alt: m[1], n: c.id })))];
  const figRows = figs.map((f, i) => `<div class="s r"><span>Diagram ${i + 1}: ${f.alt.split(".")[0].slice(0, 90)}</span><i></i><span>${pages?.["fig" + i] ?? "00"}</span></div>`);
  const swap = h => pdfShots ? h.replace(/assets\/screenshots\/([^"')]+)\.webp/g, (m, p) => `${pdfShots}/${p}.jpg`) : h;
  const shot0 = existsSync(join(docs, "assets/screenshots/public/fold-desktop-1440.webp")) ? `<img class="shot" src="assets/screenshots/public/fold-desktop-1440.webp" alt="">` : "";
  const shot = swap(shot0);
  const body = swap(rendered.map(c => `<section class="chapter" id="${c.id}-ch"><div class="kick">SECTION ${String(c.n).padStart(2, "0")}</div>${c.html}</section>`).join("\n"));
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>Form &amp; Frame Master Book v${VERSION}</title>
<meta name="author" content="FRAME for Mark Ferrer Marquez"><meta name="description" content="Form &amp; Frame Master Book v${VERSION}, commit ${SHA}">
<base href="${pathToFileURL(docs).href}/"><style>${baseCss}${printCss.replace('"Form & Frame Master Book v" var(--v,"1.0.0") " · commit 31a08f6"', `"Form & Frame Master Book v${VERSION} · commit ${SHA.slice(0, 7)} · INTERNAL"`)}</style></head><body>
<section class="cover"><div class="kick">FORM &amp; FRAME · MEDIA WALLS</div><h1>Master Book</h1>
<div class="sub">Identity, platform, public website, Owner Dashboard, backend, security, tests and roadmap, from the code, with evidence.</div>
${shot}
<div class="meta"><span class="tag">INTERNAL · CONTAINS SECURITY FINDINGS</span><p><b>Version ${VERSION}</b> · ${BUILT} · prepared by FRAME (Grok Bot) for Mark Ferrer Marquez</p>
<p>Analysed commit <code>${SHA}</code> (<code>origin/main</code>). Features that exist only in open Draft PRs are labelled PLANNED. Production and live Supabase were not accessed.</p></div></section>
<section class="tocpage"><h1>Contents</h1><div class="toc">${tocRows.join("")}<div class="c figs">Diagrams</div>${figRows.join("")}</div></section>
${body}</body></html>`;
}

function buildPdf() {
  const chrome = findChrome();
  if (!chrome) { console.warn("No Chrome/Chromium found: PDF skipped (set CHROME_BIN)."); return null; }
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "book.html"), pdfPath = join(outDir, "FORM_AND_FRAME_MASTER_BOOK.pdf");
  // optional size optimisation: JPEG copies for the PDF only (the committed WebP files and the Live Master are untouched)
  const jpgDir = join(outDir, "pdf-shots");
  const py = spawnSync("python3", [join(root, "scripts/master-docs/pdf-images.py"), join(docs, "assets/screenshots"), jpgDir], { encoding: "utf8" });
  if (py.status === 0) pdfShots = pathToFileURL(jpgDir).href; else console.warn("Pillow missing: PDF keeps WebP screenshots (larger file).");
  writeFileSync(htmlPath, bookHtml(null));
  printPdf(chrome, htmlPath, pdfPath);
  let havePoppler = true;
  try { execFileSync("pdfinfo", ["-v"], { stdio: "ignore" }); } catch (e) { if (e.code === "ENOENT") havePoppler = false; }
  if (!havePoppler) { console.warn("poppler-utils missing: contents page has no page numbers."); return pdfPath; }
  // pass 2: find the page of every chapter, heading and diagram, then rebuild with real numbers (contents length is unchanged)
  const texts = pageTexts(pdfPath);
  const rawLines = rawPageLines(pdfPath);
  const pages = {}; let from = 0;
  const norm = s => s.replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
  rendered.forEach(c => {
    const kick = `SECTION ${String(c.n).padStart(2, "0")}`;
    let p = texts.findIndex((t, i) => i >= from && t.includes(kick));
    if (p < 0) { console.warn("No page found for", c.id); return; }
    pages[c.id] = p + 1; from = p;
    let q = p;
    tocByChapter(c.id).forEach(h => {
      const needle = norm(h.text.replace(/\(.*$/, "")).slice(0, 40);
      // headings are matched at the start of a line with single spaces, so table rows (padded with runs of spaces) never match
      const lead = needle.slice(0, 30);
      const k = rawLines.findIndex((ls, i) => i >= q && ls.some(l => l.trimStart().startsWith(lead)));
      if (k >= 0) { pages[h.id] = k + 1; q = k; } else console.warn("No page found for heading", h.text);
    });
  });
  const figs = rendered.flatMap(c => [...c.html.matchAll(/<figure class="fig diagram"><img[^>]*alt="([^"]*)"/g)].map(m => m[1]));
  let fq = 0; figs.forEach((alt, i) => { const needle = norm(alt.replace(/&quot;/g, '"').replace(/&amp;/g, "&")).slice(0, 40); const k = texts.findIndex((t, j) => j >= fq && t.includes(needle)); if (k >= 0) { pages["fig" + i] = k + 1; fq = k; } });
  writeFileSync(htmlPath, bookHtml(pages));
  printPdf(chrome, htmlPath, pdfPath);
  const n = Number(execFileSync("pdfinfo", [pdfPath]).toString().match(/Pages:\s+(\d+)/)[1]);
  console.log(`PDF built: ${pdfPath} (${n} pages, ${(statSync(pdfPath).size / 1e6).toFixed(1)} MB).`);
  return pdfPath;
}

buildLive();
if (!noPdf) buildPdf();
