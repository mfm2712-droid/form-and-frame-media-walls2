import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { resolveSiteUrl } from "../site-config.mjs";
import { SAMPLE_WORKS, sampleWorksEnabled } from "../site-works.mjs";
import { SAMPLE_INTRO, SAMPLE_LABEL } from "./works-section.mjs";
import { badgeReport, readPng } from "./png-info.mjs";

const root = resolve("dist/public");
const site = resolveSiteUrl(process.env).replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
const rootEntries = new Set(await readdir(root));
assert.deepEqual(
  [...rootEntries].sort(),
  ["assets", "index.html", "operations", "public-config.js", "robots.txt", "sitemap.xml"],
  "The public build root must contain only the public website, authenticated staff app shell, public config, search files and assets."
);

for (const file of ["index.html", "public-config.js"]) {
  assert.equal((await stat(resolve(root, file))).isFile(), true, `${file} must be a file.`);
}
assert.equal((await stat(resolve(root, "assets"))).isDirectory(), true, "assets must be a directory.");
assert.equal((await stat(resolve(root, "operations/index.html"))).isFile(), true, "The staff app shell must be deployed at /operations/.");
assert.equal((await stat(resolve(root, "operations/config.js"))).isFile(), true, "The staff app must receive its browser-safe runtime config.");
assert.equal((await stat(resolve(root, "operations/push-support.mjs"))).isFile(), true, "The staff app must deploy its push capability and install guidance module.");
assert.equal((await stat(resolve(root, "operations/activity-label.mjs"))).isFile(), true, "The staff app must deploy its private activity-log renderer.");
assert.equal((await stat(resolve(root, "operations/push-target.mjs"))).isFile(), true, "Push notification links must resolve to the requested enquiry in the staff app.");
assert.equal((await stat(resolve(root, "operations/invoice-document.mjs"))).isFile(), true, "The mobile Operations app must be able to render safe printable invoices.");
assert.equal((await stat(resolve(root, "operations/payment-idempotency.mjs"))).isFile(), true, "Manual payment retries must retain their idempotency key across reloads.");
const worksOn = sampleWorksEnabled(process.env);
assert.equal(
  (await readdir(resolve(root, "assets"))).includes("cases"), worksOn,
  "assets/cases (fictitious sample photos) must be deployed only while SHOW_SAMPLE_WORKS is on."
);
const publicHtml = await readFile(resolve(root, "index.html"), "utf8");
assert.equal(publicHtml.includes("FF:WORKS"), false, "The works marker must be replaced at build time.");
if (worksOn) {
  assert.equal((publicHtml.match(/class="sample-tag">/g) || []).length, SAMPLE_WORKS.length, "Every sample project card must carry a visible 'Sample project' tag.");
  assert.ok(publicHtml.includes(SAMPLE_INTRO), "The works section must state that the projects are illustrative samples.");
  assert.equal(publicHtml.includes("Completed works"), false, "The section must not be presented as completed works.");
  for (const work of SAMPLE_WORKS) for (const image of [work.before, work.after]) assert.equal((await stat(resolve(root, image))).isFile(), true, `${image} must be deployed.`);
} else {
  assert.equal(/id="works"|id="rWorks"|assets\/cases\//.test(publicHtml), false, "With the flag off no works section may remain.");
}
const publicConfigSource = await readFile(resolve(root, "public-config.js"), "utf8");
const publicConfigMatch = /^window\.FF_PUBLIC_CONFIG = Object\.freeze\((\{.*\})\);\s*$/.exec(publicConfigSource);
assert.ok(publicConfigMatch, "The generated public config must be a valid frozen JSON object.");
const publicConfig = JSON.parse(publicConfigMatch[1]);
const publicSupabaseRef = /^https:\/\/([a-z0-9-]+)\.supabase\.co$/i.exec(publicConfig.supabaseUrl || "")?.[1]?.toLowerCase();
assert.equal(publicSupabaseRef, "otqzhocismdjbvvsjnpe", "The public build must use the dedicated Form & Frame Supabase project.");
assert.ok(/<script src="\/public-config\.js"><\/script>/.test(publicHtml), "The public page must load the generated Supabase config before its enquiry handler.");
assert.ok(/\/functions\/v1\/submit-enquiry/.test(publicHtml), "The public enquiry flow must call the server-side persistence function.");
const localStorageKeys = [...publicHtml.matchAll(/localStorage\.setItem\(\s*["']([^"']+)["']/g)].map(match => match[1]);
assert.deepEqual(
  [...new Set(localStorageKeys)].sort(),
  ["ff_spec", "ff_view"],
  "The public page may persist only configurator preferences, never customer enquiry details."
);
for (const unverifiedClaim of ["VAT at 20%", "VAT @ 20%", " ex VAT", "+ VAT", "INDICATIVE COST ALLOCATION", "INDICATIVE<br>PRO FORMA"]) {
  assert.equal(publicHtml.includes(unverifiedClaim), false, `The public page must not state unverified tax/cost claim: ${unverifiedClaim}`);
}
assert.match(publicHtml, /<html lang="en-GB">/, "The public page must declare its language for screen readers and search engines.");
for (const controlId of ["fWall", "fFinish", "fHandle", "fFire", "fLed", "fPhoto"]) {
  assert.match(publicHtml, new RegExp(`id="${controlId}"[^>]*aria-label="[^"]+"`), `Configurator control ${controlId} must have an accessible name.`);
}
assert.match(publicHtml, /not a quotation, invoice or booking/i, "The customer design summary must be clearly non-binding.");
assert.match(publicHtml, /any applicable tax treatment/i, "Tax treatment must remain for the written quotation to confirm.");
assert.match(publicHtml, /id="cWebsite"[^>]*name="company_website"/, "The public enquiry form must include its off-screen honeypot field.");
assert.match(publicHtml, /company_website:\s*\$\("cWebsite"\)\.value/, "The public enquiry payload must send the honeypot value for server-side rejection.");
const referenceCheck = publicHtml.indexOf('typeof result.reference !== "string"');
const successView = publicHtml.indexOf('form.style.display = "none"', referenceCheck);
assert.ok(referenceCheck >= 0 && successView > referenceCheck, "The public page must only show success after validating the saved enquiry reference.");

// Search and indexing: the staff app must never be indexed, and the public page's canonical must be the production address.
const robotsTxt = await readFile(resolve(root, "robots.txt"), "utf8");
assert.match(robotsTxt, /Disallow:\s*\/operations\//, "robots.txt must keep the staff app out of search results.");
assert.match(robotsTxt, new RegExp(`Sitemap:\\s*${site}/sitemap\\.xml`), "robots.txt must point at the production sitemap.");
assert.match(await readFile(resolve(root, "sitemap.xml"), "utf8"), new RegExp(`<loc>${site}/</loc>`), "The sitemap must list the production home page.");
assert.match(publicHtml, new RegExp(`<link rel="canonical" href="${site}/">`), "The canonical URL must be the production address, not a staging host.");
assert.equal(publicHtml.includes("github.io"), false, "No public metadata may point at the GitHub Pages copy.");
assert.match(await readFile(resolve(root, "operations/index.html"), "utf8"), /<meta name="robots" content="noindex, nofollow">/, "The staff app shell must be marked noindex.");
// Unverified reviews: the public page must not present sample testimonials or star ratings as client feedback.
assert.equal(/class="testimonial/.test(publicHtml) || /Sample review/i.test(publicHtml) || /★{3,}/.test(publicHtml), false, "The public page must not show sample or unverified reviews.");
// Accessibility landmarks and the friendly network error.
assert.match(publicHtml, /<main id="main">/, "The public page needs one main landmark.");
assert.equal((publicHtml.match(/<main[\s>]/g) || []).length, 1, "The public page must have exactly one main landmark.");
assert.match(publicHtml, /class="schedule" tabindex="0" role="region"/, "The scrollable schedule must be reachable by keyboard.");
assert.match(publicHtml, /error\.name === "TypeError"/, "A network failure must show a plain-language message, not the browser's raw error.");
for (const privatePath of ["supabase", "planning", "anthony-roadmap.html"]) {
  assert.equal(rootEntries.has(privatePath), false, `${privatePath} must not enter the public build.`);
}

const operationsFiles = await readdir(resolve(root, "operations"));
assert.equal(operationsFiles.includes("config.example.js"), false, "The staff app config template must not enter the deployment.");
assert.equal(operationsFiles.some(file => file.endsWith(".test.mjs")), false, "Node tests must not enter the deployment.");
const operationsAppSource = await readFile(resolve(root, "operations/app.js"), "utf8");
for (const [, importedModule] of operationsAppSource.matchAll(/from\s+["']\.\/([^"']+\.mjs)["']/g)) {
  if (importedModule.startsWith("vendor/")) {
    assert.equal((await stat(resolve(root, "operations", importedModule))).isFile(), true, `The vendored dependency ${importedModule} must be copied into the public build.`);
  } else {
    assert.ok(operationsFiles.includes(importedModule), `The staff app dependency ${importedModule} must be copied into the public build.`);
  }
}
assert.equal(/from\s+["']https?:\/\//.test(operationsAppSource), false, "The staff app must not import code from a remote host at runtime.");
{
  // The deployed vendored module must match the integrity recorded in VENDOR.json.
  const vendorInfo = JSON.parse(await readFile(resolve("operations/vendor/VENDOR.json"), "utf8"));
  const deployedVendor = await readFile(resolve(root, "operations/vendor", vendorInfo.vendoredFile));
  assert.equal(`sha384-${createHash("sha384").update(deployedVendor).digest("base64")}`, vendorInfo.sriSha384, "The deployed vendored supabase-js must match its recorded integrity hash.");
}
const operationsConfig = await readFile(resolve(root, "operations/config.js"), "utf8");
assert.match(operationsConfig, /^window\.FF_OPERATIONS_CONFIG = Object\.freeze\(/, "Operations receives generated browser-safe config.");
for (const forbiddenSecretName of ["SUPABASE_SERVICE_ROLE_KEY", "VAPID_PRIVATE_KEY", "PUSH_DISPATCH_TOKEN", "RESEND_API_KEY"]) {
  assert.equal(operationsConfig.includes(forbiddenSecretName), false, `Server secret ${forbiddenSecretName} must not enter the staff app config.`);
}
const operationsHtml = await readFile(resolve(root, "operations/index.html"), "utf8");
assert.match(operationsHtml, /Send secure link/, "Operations requires staff sign-in.");
// Every relative module the staff app imports must actually be deployed (a missing one breaks sign-in).
for (const entry of ["app.js", ...(await readdir(resolve(root, "operations"))).filter(name => name.endsWith(".mjs"))]) {
  const source = await readFile(resolve(root, "operations", entry), "utf8");
  for (const match of source.matchAll(/from\s+"\.\/([A-Za-z0-9._-]+\.mjs)"/g)) {
    assert.equal((await stat(resolve(root, "operations", match[1]))).isFile(), true, `operations/${entry} imports ${match[1]}, which must be deployed.`);
  }
}
assert.match(operationsHtml, /id="workspace"/, "The enquiry workspace container must be deployed.");


// Android status-bar icon: the manifest and the service worker must point at files that were
// really deployed, and the badge must be a transparent white mask (an opaque one renders as a white square).
const deployedManifest = JSON.parse(await readFile(resolve(root, "operations/manifest.webmanifest"), "utf8"));
const deployedWorker = await readFile(resolve(root, "operations/service-worker.js"), "utf8");
for (const icon of deployedManifest.icons) {
  const path = resolve(root, "operations", icon.src.split("?")[0].replace(/^\.\//, ""));
  assert.equal((await stat(path)).isFile(), true, `Manifest icon ${icon.src} must be deployed.`);
}
const workerBadge = /const NOTIFICATION_BADGE = "([^"]+)"/.exec(deployedWorker)?.[1];
assert.ok(workerBadge, "The service worker must declare its notification badge.");
assert.ok(deployedManifest.icons.some(icon => icon.purpose === "monochrome" && icon.src === workerBadge), "The manifest must declare the worker's badge as a monochrome icon.");
for (const icon of deployedManifest.icons.filter(icon => icon.purpose === "monochrome")) {
  const report = badgeReport(readPng(await readFile(resolve(root, "operations", icon.src.split("?")[0].replace(/^\.\//, "")))));
  assert.ok(report.hasAlphaChannel && report.transparentShare > 0.5 && report.nonWhiteVisiblePixels === 0 && report.edgeVisiblePixels === 0,
    `Deployed monochrome icon ${icon.src} must be a transparent white mask, not an opaque image.`);
}

assert.equal(publicHtml.includes("FF:CONTACT"), false, "The footer contact marker must be replaced at build time.");
console.log(`Verified public build root: ${[...rootEntries].sort().join(", ")}`);
