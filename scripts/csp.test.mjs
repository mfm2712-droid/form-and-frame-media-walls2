import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const all = Object.fromEntries(config.headers.find(rule => rule.source === "/(.*)").headers.map(h => [h.key, h.value]));
const policy = Object.fromEntries((all["Content-Security-Policy-Report-Only"] || "").split(";").map(d => d.trim()).filter(Boolean).map(d => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));
const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [publicHtml, staffHtml, staffApp, serviceWorker] = await Promise.all([read("../index.html"), read("../operations/index.html"), read("../operations/app.js"), read("../operations/service-worker.js")]);

function inlineScriptHashes(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=/i.test(attributes))
    .filter(([, attributes]) => ["text/javascript", "application/javascript"].includes((/\btype\s*=\s*"([^"]+)"/i.exec(attributes)?.[1] || "text/javascript").toLowerCase()))
    .map(([, , source]) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`);
}

test("a Content-Security-Policy-Report-Only header is served on every page, and it is not (yet) enforcing", () => {
  assert.ok(all["Content-Security-Policy-Report-Only"], "report-only CSP missing");
  assert.equal("Content-Security-Policy" in all, false, "enforcing CSP must wait until the report-only phase has been observed on a signed-in staff session");
});

test("script-src is 'self' plus exactly the hashes of the inline scripts that really execute; no eval or remote scripts", () => {
  const expected = [...inlineScriptHashes(publicHtml), ...inlineScriptHashes(staffHtml)].sort();
  const actual = policy["script-src"].filter(v => v.startsWith("'sha256-")).sort();
  assert.deepEqual(actual, expected, "Update the CSP hash in vercel.json whenever the inline script in index.html changes.");
  assert.ok(policy["script-src"].includes("'self'"));
  for (const bad of ["'unsafe-eval'", "'unsafe-inline'", "https:", "*", "https://esm.sh"]) assert.equal(policy["script-src"].includes(bad), false, `script-src must not allow ${bad}`);
});

test("the staff app imports no script from a remote host (esm.sh removed) so script-src can stay 'self'", () => {
  assert.equal(/from\s+["']https?:\/\//.test(staffApp), false);
  assert.equal(/import\(\s*["']https?:\/\//.test(staffApp), false);
  assert.equal(/importScripts\(\s*["']https?:\/\//.test(serviceWorker), false);
  for (const html of [publicHtml, staffHtml]) {
    for (const [tag] of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^>]*>/gi)) assert.fail(`remote script tag: ${tag}`);
  }
});

test("every external origin the pages really use is allowed, and nothing broader than needed", () => {
  const externalLinks = [...(publicHtml + staffHtml).matchAll(/<link\b[^>]*\bhref\s*=\s*"(https:\/\/[^"/]+)[^"]*"[^>]*>/gi)]
    .filter(([tag]) => !/rel="(?:canonical|preconnect)"/.test(tag)).map(match => match[1]);
  assert.deepEqual([...new Set(externalLinks)], ["https://fonts.googleapis.com"], "unexpected external stylesheet/resource host: extend the CSP deliberately");
  assert.ok(policy["style-src"].includes("https://fonts.googleapis.com"));
  assert.deepEqual(policy["font-src"], ["https://fonts.gstatic.com"]);
  assert.ok(policy["connect-src"].includes("https://*.supabase.co") && policy["connect-src"].includes("wss://*.supabase.co"), "Supabase REST/auth/functions and realtime");
  assert.ok(policy["img-src"].includes("data:") && policy["img-src"].includes("blob:"), "configurator photo preview uses a data URL");
  assert.deepEqual(policy["frame-ancestors"], ["'self'"]);
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
  assert.ok(policy["worker-src"].includes("'self'"), "service worker is registered from ./service-worker.js");
  assert.equal(policy["connect-src"].some(v => v === "*" || v === "https:" || v === "wss:"), false);
});

test("'unsafe-inline' is allowed for styles only because the pages use inline style attributes and a style block", () => {
  assert.ok(policy["style-src"].includes("'unsafe-inline'"));
  assert.match(publicHtml, /style="/);
  assert.equal(/\son[a-z]+\s*=\s*"/i.test(publicHtml + staffHtml), false, "no inline event-handler attributes, so script-src needs no 'unsafe-inline'");
});

test("existing baseline headers are unchanged", () => {
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.equal(all["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(all["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(all["Permissions-Policy"], /camera=\(\)/);
});
