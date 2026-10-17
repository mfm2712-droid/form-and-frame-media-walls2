import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const headersFor = source => Object.fromEntries((config.headers.find(rule => rule.source === source)?.headers || []).map(h => [h.key, h.value]));

test("every page is served with baseline security headers", () => {
  const all = headersFor("/(.*)");
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.equal(all["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(all["X-Frame-Options"], "SAMEORIGIN");
  assert.match(all["Permissions-Policy"], /camera=\(\)/);
  assert.match(all["Permissions-Policy"], /geolocation=\(\)/);
});

test("the staff app is excluded from search by header as well as by meta tag", () => {
  assert.match(headersFor("/operations/(.*)")["X-Robots-Tag"], /noindex/);
});

test("the production build command and output directory are unchanged", () => {
  assert.equal(config.buildCommand, "node scripts/build-public.mjs");
  assert.equal(config.outputDirectory, "dist/public");
});
